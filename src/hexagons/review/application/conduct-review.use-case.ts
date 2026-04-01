import { randomUUID } from "node:crypto";
import { err, type ModelProfileName, ok, type Result } from "@kernel";
import {
  type AgentDispatchConfig,
  type AgentDispatchPort,
  type AgentResult,
  getAgentCard,
  type ResolvedModel,
} from "@kernel/agents";
import type { DateProviderPort, EventBusPort, LoggerPort } from "@kernel/ports";
import type { ConductReviewRequest, ConductReviewResult } from "../domain/conduct-review.schemas";
import { ConductReviewRequestSchema } from "../domain/conduct-review.schemas";
import { ConductReviewError } from "../domain/errors/conduct-review.error";
import { FreshReviewerViolationError } from "../domain/errors/fresh-reviewer-violation.error";
import { ReviewPipelineCompletedEvent } from "../domain/events/review-pipeline-completed.event";
import { MergedReview } from "../domain/merged-review.vo";
import type { ChangedFilesPort } from "../domain/ports/changed-files.port";
import type { FixerPort } from "../domain/ports/fixer.port";
import type { ReviewRepositoryPort } from "../domain/ports/review-repository.port";
import type { SliceSpec, SliceSpecPort } from "../domain/ports/slice-spec.port";
import { Review } from "../domain/review.aggregate";
import { type FindingProps, FindingPropsSchema, type ReviewRole } from "../domain/review.schemas";
import { strategyForRole } from "../domain/review-strategy";
import type { CritiqueReflectionService } from "../domain/services/critique-reflection.service";
import type { FreshReviewerService } from "../domain/services/fresh-reviewer.service";
import type { ReviewPromptBuilder } from "./review-prompt-builder";

const REVIEWER_ROLES: readonly ReviewRole[] = [
  "code-reviewer",
  "spec-reviewer",
  "security-auditor",
] as const;

interface DispatchOutcome {
  readonly role: ReviewRole;
  readonly taskId: string;
  readonly status: "completed" | "failed" | "timed_out";
  readonly result?: AgentResult;
  readonly error?: unknown;
}

export class ConductReviewUseCase {
  constructor(
    private readonly sliceSpecPort: SliceSpecPort,
    private readonly changedFilesPort: ChangedFilesPort,
    private readonly freshReviewerService: FreshReviewerService,
    private readonly agentDispatchPort: AgentDispatchPort,
    private readonly critiqueReflectionService: CritiqueReflectionService,
    private readonly reviewPromptBuilder: ReviewPromptBuilder,
    private readonly modelResolver: (profile: ModelProfileName) => ResolvedModel,
    private readonly fixerPort: FixerPort,
    private readonly reviewRepository: ReviewRepositoryPort,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    request: ConductReviewRequest,
  ): Promise<Result<ConductReviewResult, ConductReviewError>> {
    const parsed = ConductReviewRequestSchema.parse(request);

    // Step 1: Resolve context
    const specResult = await this.sliceSpecPort.getSpec(parsed.sliceId);
    if (!specResult.ok) {
      return err(ConductReviewError.contextResolutionFailed(parsed.sliceId, specResult.error));
    }

    const diffResult = await this.changedFilesPort.getDiff(parsed.sliceId, parsed.workingDirectory);
    if (!diffResult.ok) {
      return err(ConductReviewError.contextResolutionFailed(parsed.sliceId, diffResult.error));
    }

    const spec = specResult.data;
    const diff = diffResult.data;

    // Step 2: Enforce fresh-reviewer for each role
    const agentIdentities = new Map<ReviewRole, string>();
    for (const role of REVIEWER_ROLES) {
      const identity = `${role}-${randomUUID()}`;
      agentIdentities.set(role, identity);
      const enforceResult = await this.freshReviewerService.enforce(parsed.sliceId, identity);
      if (!enforceResult.ok) {
        if (enforceResult.error instanceof FreshReviewerViolationError) {
          return err(ConductReviewError.freshReviewerBlocked(parsed.sliceId, role, identity));
        }
        // ExecutorQueryError → fail-closed
        return err(ConductReviewError.contextResolutionFailed(parsed.sliceId, enforceResult.error));
      }
    }

    // Step 3: Dispatch reviewers (parallel with timeout + retry)
    const outcomes = await this.dispatchAllReviewers(spec, diff, parsed, agentIdentities);

    // Step 3b: Check for total failure
    const allFailed = outcomes.every((o) => o.status !== "completed");
    if (allFailed) {
      return err(
        ConductReviewError.allReviewersFailed(
          parsed.sliceId,
          outcomes.map((o) => ({ role: o.role, cause: String(o.error ?? "unknown") })),
        ),
      );
    }

    // Step 3c: Check for individual retry exhaustion
    for (const outcome of outcomes) {
      if (outcome.status !== "completed") {
        return err(
          ConductReviewError.reviewerRetryExhausted(parsed.sliceId, outcome.role, outcome.error),
        );
      }
    }

    // Step 4: Process results — create Review aggregates
    const reviews: Review[] = [];
    const now = this.dateProvider.now();

    for (const outcome of outcomes) {
      const review = Review.createNew({
        id: randomUUID(),
        sliceId: parsed.sliceId,
        role: outcome.role,
        agentIdentity: this.resolveIdentity(agentIdentities, outcome.role),
        now,
      });

      // Parse findings from agent output
      const findings = this.extractFindings(outcome);
      review.recordFindings(findings, now);

      // Save to repository
      await this.reviewRepository.save(review);
      reviews.push(review);
    }

    // Step 5: Merge reviews
    const mergeResult = MergedReview.merge(reviews, now);
    if (!mergeResult.ok) {
      return err(ConductReviewError.mergeError(parsed.sliceId, mergeResult.error));
    }

    // Step 6: Fixer loop — if blockers exist and fix cycles remain
    let merged = mergeResult.data;
    let allReviews = [...reviews];
    let fixCyclesUsed = 0;
    let currentDiff = diff;

    while (merged.hasBlockers() && fixCyclesUsed < parsed.maxFixCycles) {
      // 6a: Fix — pass ALL findings (not just blockers)
      const allFindings: FindingProps[] = merged.findings.map((f) => ({
        id: f.id,
        severity: f.severity,
        message: f.message,
        filePath: f.filePath,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
        suggestion: f.suggestion,
        ruleId: f.ruleId,
        impact: f.impact,
      }));

      const fixResult = await this.fixerPort.fix({
        sliceId: parsed.sliceId,
        findings: allFindings,
        workingDirectory: parsed.workingDirectory,
      });

      if (!fixResult.ok) {
        // AC26: graceful stop, return current result
        this.logger.warn("Fixer failed — stopping loop", {
          error: fixResult.error.message,
        });
        break;
      }

      fixCyclesUsed++;

      // 6b: Re-fetch diff (fixer may have changed files)
      const reDiffResult = await this.changedFilesPort.getDiff(
        parsed.sliceId,
        parsed.workingDirectory,
      );
      if (!reDiffResult.ok) {
        this.logger.warn("Re-diff failed after fix — stopping loop");
        break;
      }
      currentDiff = reDiffResult.data;

      // 6c: Re-dispatch all 3 reviewers (fresh-reviewer enforcement re-applied)
      const reIdentities = new Map<ReviewRole, string>();
      let freshReviewerFailed = false;
      for (const role of REVIEWER_ROLES) {
        const identity = `${role}-${randomUUID()}`;
        reIdentities.set(role, identity);
        const enforceResult = await this.freshReviewerService.enforce(parsed.sliceId, identity);
        if (!enforceResult.ok) {
          this.logger.warn("Fresh-reviewer violation on re-review", { role });
          freshReviewerFailed = true;
          break;
        }
      }
      if (freshReviewerFailed) break;

      const reOutcomes = await this.dispatchAllReviewers(spec, currentDiff, parsed, reIdentities);

      // Check for total failure
      const reAllFailed = reOutcomes.every((o) => o.status !== "completed");
      if (reAllFailed) {
        this.logger.warn("All reviewers failed on re-review — stopping loop");
        break;
      }

      const successfulOutcomes = reOutcomes.filter((o) => o.status === "completed");
      if (successfulOutcomes.length < 3) {
        this.logger.warn("Some reviewers failed on re-review — stopping loop");
        break;
      }

      // 6d: Create new reviews and merge
      const reNow = this.dateProvider.now();
      const reReviews: Review[] = [];
      for (const outcome of successfulOutcomes) {
        const review = Review.createNew({
          id: randomUUID(),
          sliceId: parsed.sliceId,
          role: outcome.role,
          agentIdentity: this.resolveIdentity(reIdentities, outcome.role),
          now: reNow,
        });
        review.recordFindings(this.extractFindings(outcome), reNow);
        await this.reviewRepository.save(review);
        reReviews.push(review);
      }
      allReviews = [...allReviews, ...reReviews];

      const reMergeResult = MergedReview.merge(reReviews, reNow);
      if (!reMergeResult.ok) {
        this.logger.warn("Merge failed on re-review — stopping loop");
        break;
      }
      merged = reMergeResult.data;
    }

    // Step 7: Emit ReviewPipelineCompletedEvent
    const completedEvent = new ReviewPipelineCompletedEvent({
      id: randomUUID(),
      aggregateId: parsed.sliceId,
      occurredAt: this.dateProvider.now(),
      sliceId: parsed.sliceId,
      verdict: merged.verdict,
      reviewCount: allReviews.length,
      findingsCount: merged.findings.length,
      blockerCount: merged.findings.filter(
        (f) => f.severity === "critical" || f.severity === "high",
      ).length,
      conflictCount: merged.conflicts.length,
      fixCyclesUsed,
      timedOutRoles: [],
      retriedRoles: [],
    });
    await this.eventBus.publish(completedEvent);

    return ok({
      mergedReview: merged.toJSON(),
      individualReviews: allReviews.map((r) => r.toJSON()),
      fixCyclesUsed,
      timedOutReviewers: [],
      retriedReviewers: [],
    });
  }

  private resolveIdentity(identities: Map<ReviewRole, string>, role: ReviewRole): string {
    const identity = identities.get(role);
    if (identity === undefined) {
      throw new Error(`[BUG] Missing agent identity for role "${role}"`);
    }
    return identity;
  }

  private async dispatchAllReviewers(
    spec: SliceSpec,
    diff: string,
    request: ConductReviewRequest,
    agentIdentities: Map<ReviewRole, string>,
  ): Promise<DispatchOutcome[]> {
    // Parallel dispatch — all 3 initiated before any is awaited
    const firstAttempts = await Promise.allSettled(
      REVIEWER_ROLES.map((role) =>
        this.dispatchWithTimeout(
          role,
          spec,
          diff,
          request,
          this.resolveIdentity(agentIdentities, role),
        ),
      ),
    );

    const outcomes: DispatchOutcome[] = [];
    const retryRoles: ReviewRole[] = [];

    for (let i = 0; i < REVIEWER_ROLES.length; i++) {
      const role = REVIEWER_ROLES[i];
      const settled = firstAttempts[i];
      if (settled.status === "fulfilled" && settled.value.status === "completed") {
        outcomes.push(settled.value);
      } else {
        retryRoles.push(role);
      }
    }

    // Retry failed reviewers — max 1 retry each
    if (retryRoles.length > 0) {
      this.logger.info("Retrying failed reviewers", {
        roles: retryRoles,
        sliceId: request.sliceId,
      });

      const retries = await Promise.allSettled(
        retryRoles.map((role) =>
          this.dispatchWithTimeout(
            role,
            spec,
            diff,
            request,
            this.resolveIdentity(agentIdentities, role),
          ),
        ),
      );

      for (let i = 0; i < retryRoles.length; i++) {
        const role = retryRoles[i];
        const settled = retries[i];
        if (settled.status === "fulfilled" && settled.value.status === "completed") {
          outcomes.push(settled.value);
        } else {
          const error = settled.status === "rejected" ? settled.reason : settled.value?.error;
          outcomes.push({ role, taskId: "", status: "failed", error });
        }
      }
    }

    return outcomes;
  }

  private async dispatchWithTimeout(
    role: ReviewRole,
    spec: SliceSpec,
    diff: string,
    request: ConductReviewRequest,
    _agentIdentity: string,
  ): Promise<DispatchOutcome> {
    const taskId = randomUUID();
    const card = getAgentCard(role);
    const model = this.modelResolver(card.defaultModelProfile);
    const prompt = this.reviewPromptBuilder.build({
      sliceId: request.sliceId,
      sliceLabel: spec.sliceLabel,
      sliceTitle: spec.sliceTitle,
      role,
      changedFiles: diff,
      acceptanceCriteria: spec.acceptanceCriteria,
    });

    const config: AgentDispatchConfig = {
      taskId,
      sliceId: request.sliceId,
      agentType: role,
      workingDirectory: request.workingDirectory,
      systemPrompt: prompt,
      taskPrompt: "Review the changes and return structured findings as JSON",
      model,
      tools: card.requiredTools,
      filePaths: [],
    };

    // Race dispatch against timeout
    const dispatchPromise = this.agentDispatchPort.dispatch(config);
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), request.timeoutMs);
    });

    const raceResult = await Promise.race([dispatchPromise, timeoutPromise]);

    if (raceResult === null) {
      // Timed out — abort the running agent
      await this.agentDispatchPort.abort(taskId);
      this.logger.warn("Reviewer timed out", { role, taskId, timeoutMs: request.timeoutMs });
      return {
        role,
        taskId,
        status: "timed_out",
        error: `Timed out after ${request.timeoutMs}ms`,
      };
    }

    if (!raceResult.ok) {
      this.logger.warn("Reviewer dispatch failed", { role, taskId, error: raceResult.error });
      return { role, taskId, status: "failed", error: raceResult.error };
    }

    return { role, taskId, status: "completed", result: raceResult.data };
  }

  private extractFindings(outcome: DispatchOutcome): FindingProps[] {
    if (!outcome.result) return [];

    const strategy = strategyForRole(outcome.role);
    if (strategy === "critique-then-reflection") {
      try {
        const rawResult: unknown = JSON.parse(outcome.result.output);
        const processed = this.critiqueReflectionService.processResult(rawResult);
        if (!processed.ok) {
          this.logger.warn("CTR parse error — degraded to 0 findings", {
            role: outcome.role,
            error: processed.error.message,
          });
          return [];
        }
        return processed.data.findings;
      } catch {
        this.logger.warn("JSON parse error on CTR output — degraded to 0 findings", {
          role: outcome.role,
        });
        return [];
      }
    }

    // Standard role — parse JSON array of findings directly
    try {
      const parsed: unknown = JSON.parse(outcome.result.output);
      return Array.isArray(parsed)
        ? parsed.filter((f) => FindingPropsSchema.safeParse(f).success)
        : [];
    } catch {
      return [];
    }
  }
}

import { randomUUID } from "node:crypto";
import { err, type ModelProfileName, type Result } from "@kernel";
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
import type { ChangedFilesPort } from "../domain/ports/changed-files.port";
import type { FixerPort } from "../domain/ports/fixer.port";
import type { ReviewRepositoryPort } from "../domain/ports/review-repository.port";
import type { SliceSpec, SliceSpecPort } from "../domain/ports/slice-spec.port";
import type { ReviewRole } from "../domain/review.schemas";
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
    readonly _freshReviewerService: FreshReviewerService,
    private readonly agentDispatchPort: AgentDispatchPort,
    readonly _critiqueReflectionService: CritiqueReflectionService,
    private readonly reviewPromptBuilder: ReviewPromptBuilder,
    private readonly modelResolver: (profile: ModelProfileName) => ResolvedModel,
    readonly _fixerPort: FixerPort,
    readonly _reviewRepository: ReviewRepositoryPort,
    readonly _eventBus: EventBusPort,
    readonly _dateProvider: DateProviderPort,
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

    // Step 2: Dispatch reviewers (parallel with timeout + retry)
    const outcomes = await this.dispatchAllReviewers(spec, diff, parsed);

    // Step 3: Check for total failure
    const allFailed = outcomes.every((o) => o.status !== "completed");
    if (allFailed) {
      return err(
        ConductReviewError.allReviewersFailed(
          parsed.sliceId,
          outcomes.map((o) => ({ role: o.role, cause: String(o.error ?? "unknown") })),
        ),
      );
    }

    // Step 4: Check for individual retry exhaustion
    for (const outcome of outcomes) {
      if (outcome.status !== "completed") {
        return err(
          ConductReviewError.reviewerRetryExhausted(parsed.sliceId, outcome.role, outcome.error),
        );
      }
    }

    // T09/T10 will add: fresh-reviewer enforcement, CTR processing,
    // Review creation, merge, persist, fixer loop, event emission.
    // For now, return a placeholder error that satisfies the type signature.
    return err(ConductReviewError.mergeError(parsed.sliceId, new Error("T09/T10 not implemented")));
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
  ): Promise<DispatchOutcome[]> {
    const agentIdentities = new Map<ReviewRole, string>();
    for (const role of REVIEWER_ROLES) {
      agentIdentities.set(role, `${role}-${randomUUID()}`);
    }

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
}

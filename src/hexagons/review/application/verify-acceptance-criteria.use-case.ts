import { err, type ModelProfileName, ok, type Result } from "@kernel";
import type {
  AgentDispatchConfig,
  AgentDispatchPort,
  AgentResult,
  ResolvedModel,
} from "@kernel/agents";
import type { DateProviderPort, EventBusPort, LoggerPort } from "@kernel/ports";
import { z } from "zod";
import { FreshReviewerViolationError } from "../domain/errors/fresh-reviewer-violation.error";
import { VerifyError } from "../domain/errors/verify.error";
import { VerificationCompletedEvent } from "../domain/events/verification-completed.event";
import type { FixerPort } from "../domain/ports/fixer.port";
import type { ReviewUIPort } from "../domain/ports/review-ui.port";
import type { SliceSpec, SliceSpecPort } from "../domain/ports/slice-spec.port";
import type { VerificationRepositoryPort } from "../domain/ports/verification-repository.port";
import type { FindingProps } from "../domain/review.schemas";
import type { VerificationUIContext } from "../domain/review-ui.schemas";
import type { FreshReviewerService } from "../domain/services/fresh-reviewer.service";
import { Verification } from "../domain/verification.aggregate";
import {
  type CriterionVerdictProps,
  CriterionVerdictSchema,
  type VerifyRequest,
  VerifyRequestSchema,
  type VerifyResult,
} from "../domain/verification.schemas";

function parseCriteria(acceptanceCriteria: string): string[] {
  return acceptanceCriteria
    .split("\n")
    .filter((line) => line.trimStart().startsWith("- "))
    .map((line) => line.trimStart().slice(2).trim());
}

function toUIContext(spec: SliceSpec, verification: Verification): VerificationUIContext {
  return {
    sliceId: spec.sliceId,
    sliceLabel: spec.sliceLabel,
    criteria: verification.criteria.map((c) => ({
      criterion: c.criterion,
      verdict: c.verdict,
      evidence: c.evidence,
    })),
    overallVerdict: verification.overallVerdict,
  };
}

export class VerifyAcceptanceCriteriaUseCase {
  constructor(
    private readonly sliceSpecPort: SliceSpecPort,
    private readonly freshReviewerService: FreshReviewerService,
    private readonly agentDispatchPort: AgentDispatchPort,
    private readonly fixerPort: FixerPort,
    private readonly verificationRepository: VerificationRepositoryPort,
    private readonly reviewUIPort: ReviewUIPort,
    private readonly modelResolver: (profile: ModelProfileName) => ResolvedModel,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
    private readonly generateId: () => string,
    private readonly logger: LoggerPort,
    private readonly templateLoader: (path: string) => string,
  ) {}

  async execute(request: VerifyRequest): Promise<Result<VerifyResult, VerifyError>> {
    // Step 1: Parse + validate request
    const parsed = VerifyRequestSchema.parse(request);

    // Step 2: Resolve context
    const specResult = await this.sliceSpecPort.getSpec(parsed.sliceId);
    if (!specResult.ok) {
      return err(VerifyError.contextResolutionFailed(parsed.sliceId, specResult.error));
    }
    const spec = specResult.data;

    // Step 3: Parse criteria
    const criteria = parseCriteria(spec.acceptanceCriteria);

    // Step 4: Generate agent identity
    const agentId = `verifier-${this.generateId()}`;

    // Step 5: Enforce fresh-reviewer
    const enforceResult = await this.freshReviewerService.enforce(parsed.sliceId, agentId);
    if (!enforceResult.ok) {
      if (enforceResult.error instanceof FreshReviewerViolationError) {
        return err(VerifyError.freshReviewerBlocked(parsed.sliceId, agentId));
      }
      // ExecutorQueryError -> fail-closed
      return err(VerifyError.contextResolutionFailed(parsed.sliceId, enforceResult.error));
    }

    // Step 6-14: Dispatch loop with fix cycles
    const verifications: Verification[] = [];
    let fixCyclesUsed = 0;
    let retriedVerification = false;
    let currentCycle = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Step 6: Build prompt
      const prompt = this.buildPrompt(spec, criteria, parsed.workingDirectory);

      // Step 7: Build dispatch config
      const taskId = this.generateId();
      const model = this.modelResolver("quality");
      const config: AgentDispatchConfig = {
        taskId,
        sliceId: parsed.sliceId,
        agentType: "verifier",
        workingDirectory: parsed.workingDirectory,
        systemPrompt: prompt,
        taskPrompt: "Verify each acceptance criterion and return structured verdicts as JSON",
        model,
        tools: ["Read", "Grep", "Glob", "Bash"],
        filePaths: [],
      };

      // Step 8: Dispatch with timeout + retry
      const dispatchResult = await this.dispatchWithTimeout(config, parsed.timeoutMs);

      let agentResult: AgentResult;
      if (!dispatchResult.ok) {
        // Retry once
        retriedVerification = true;
        this.logger.info("Retrying verifier dispatch", { sliceId: parsed.sliceId });
        const retryResult = await this.dispatchWithTimeout(config, parsed.timeoutMs);
        if (!retryResult.ok) {
          return err(VerifyError.verifierFailed(parsed.sliceId, retryResult.error));
        }
        agentResult = retryResult.data;
      } else {
        agentResult = dispatchResult.data;
      }

      // Step 9: Parse output
      let verdicts: CriterionVerdictProps[];
      try {
        const rawParsed: unknown = JSON.parse(agentResult.output);
        const parseResult = z.array(CriterionVerdictSchema).safeParse(rawParsed);
        if (!parseResult.success || parseResult.data.length === 0) {
          return err(VerifyError.parseError(parsed.sliceId, agentResult.output));
        }
        verdicts = parseResult.data;
      } catch {
        return err(VerifyError.parseError(parsed.sliceId, agentResult.output));
      }

      // Step 10: Create Verification aggregate
      const now = this.dateProvider.now();
      const verification = Verification.createNew({
        id: this.generateId(),
        sliceId: parsed.sliceId,
        agentIdentity: agentId,
        fixCycleIndex: currentCycle,
        now,
      });
      verification.recordCriteria(verdicts);
      await this.verificationRepository.save(verification);
      verifications.push(verification);

      // Step 11: Present verification to UI
      await this.reviewUIPort.presentVerification(toUIContext(spec, verification));

      // Step 12: Fixer loop check
      if (verification.overallVerdict === "FAIL" && currentCycle < parsed.maxFixCycles) {
        const failedCriteria = verdicts.filter((v) => v.verdict === "FAIL");
        const findings: FindingProps[] = failedCriteria.map((c) => ({
          id: this.generateId(),
          severity: "high" as const,
          message: `FAIL: ${c.criterion} — ${c.evidence}`,
          filePath: "verification",
          lineStart: 1,
        }));

        const fixResult = await this.fixerPort.fix({
          sliceId: parsed.sliceId,
          findings,
          workingDirectory: parsed.workingDirectory,
        });

        if (!fixResult.ok) {
          // AC26: graceful stop
          this.logger.warn("Fixer failed — stopping loop", {
            error: fixResult.error.message,
          });
          break;
        }

        fixCyclesUsed++;
        currentCycle++;
        continue;
      }

      // No more fix cycles needed or all passed
      break;
    }

    // Step 13: Emit VerificationCompletedEvent
    const lastVerification = verifications[verifications.length - 1];
    const finalVerdict = lastVerification.overallVerdict;

    const completedEvent = new VerificationCompletedEvent({
      id: this.generateId(),
      aggregateId: parsed.sliceId,
      occurredAt: this.dateProvider.now(),
      sliceId: parsed.sliceId,
      finalVerdict,
      criteriaCount: lastVerification.criteria.length,
      passCount: lastVerification.passCount,
      failCount: lastVerification.failCount,
      fixCyclesUsed,
      retriedVerification,
    });
    await this.eventBus.publish(completedEvent);

    // Step 14: Return result
    return ok({
      sliceId: parsed.sliceId,
      verifications: verifications.map((v) => v.toJSON()),
      finalVerdict,
      fixCyclesUsed,
      retriedVerification,
    });
  }

  private buildPrompt(spec: SliceSpec, criteria: string[], workingDirectory: string): string {
    const template = this.templateLoader("prompts/verify-acceptance-criteria.md");
    return template
      .replace(/\{\{sliceLabel\}\}/g, spec.sliceLabel)
      .replace(/\{\{sliceTitle\}\}/g, spec.sliceTitle)
      .replace(/\{\{specContent\}\}/g, spec.specContent)
      .replace(/\{\{acceptanceCriteria\}\}/g, criteria.map((c) => `- ${c}`).join("\n"))
      .replace(/\{\{workingDirectory\}\}/g, workingDirectory);
  }

  private async dispatchWithTimeout(
    config: AgentDispatchConfig,
    timeoutMs: number,
  ): Promise<Result<AgentResult, VerifyError>> {
    const dispatchPromise = this.agentDispatchPort.dispatch(config);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
    });

    const raceResult = await Promise.race([dispatchPromise, timeoutPromise]);
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

    if (raceResult === null) {
      await this.agentDispatchPort.abort(config.taskId);
      return err(VerifyError.verifierFailed(config.sliceId, `Timed out after ${timeoutMs}ms`));
    }

    if (!raceResult.ok) {
      return err(VerifyError.verifierFailed(config.sliceId, raceResult.error));
    }

    return ok(raceResult.data);
  }
}

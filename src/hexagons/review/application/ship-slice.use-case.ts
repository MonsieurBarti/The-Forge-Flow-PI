import type { WorktreePort } from "@hexagons/execution/domain/ports/worktree.port";
import type { SliceTransitionPort } from "@hexagons/workflow/domain/ports/slice-transition.port";
import { err, ok, type Result } from "@kernel";
import type { DateProviderPort, EventBusPort, LoggerPort } from "@kernel/ports";
import type { GitPort } from "@kernel/ports/git.port";
import type { GitHubPort } from "@kernel/ports/github.port";
import type { PullRequestInfo } from "@kernel/ports/github.schemas";
import type { ConductReviewRequest, ConductReviewResult } from "../domain/schemas/conduct-review.schemas";
import { ShipError } from "../domain/errors/ship.error";
import { SliceShippedEvent } from "../domain/events/slice-shipped.event";
import type { FixerPort } from "../domain/ports/fixer.port";
import type { MergeGatePort } from "../domain/ports/merge-gate.port";
import type { ShipRecordRepositoryPort } from "../domain/ports/ship-record-repository.port";
import type { SliceSpec, SliceSpecPort } from "../domain/ports/slice-spec.port";
import type { FindingProps } from "../domain/schemas/review.schemas";
import { type ShipRequest, ShipRequestSchema, type ShipResult } from "../domain/schemas/ship.schemas";
import { ShipRecord } from "../domain/aggregates/ship-record.aggregate";

export function buildPRBody(spec: SliceSpec): string {
  const summaryParagraph = spec.specContent.split("\n\n")[0] ?? spec.specContent;
  return `## Summary\n${summaryParagraph}\n\n## Test Plan\n${spec.acceptanceCriteria}`;
}

/** Strips sourceReviewIds from a merged finding to produce a plain FindingProps. */
function toFindingProps(f: {
  id: string;
  severity: FindingProps["severity"];
  message: string;
  filePath: string;
  lineStart: number;
  lineEnd?: number;
  suggestion?: string;
  ruleId?: string;
  impact?: FindingProps["impact"];
}): FindingProps {
  return {
    id: f.id,
    severity: f.severity,
    message: f.message,
    filePath: f.filePath,
    lineStart: f.lineStart,
    lineEnd: f.lineEnd,
    suggestion: f.suggestion,
    ruleId: f.ruleId,
    impact: f.impact,
  };
}

export class ShipSliceUseCase {
  constructor(
    private readonly sliceSpecPort: SliceSpecPort,
    private readonly gitHubPort: GitHubPort,
    private readonly mergeGatePort: MergeGatePort,
    private readonly shipRecordRepository: ShipRecordRepositoryPort,
    private readonly conductReview: {
      execute(request: ConductReviewRequest): Promise<Result<ConductReviewResult, unknown>>;
    },
    private readonly fixerPort: FixerPort,
    private readonly gitPort: GitPort,
    private readonly worktreePort: WorktreePort,
    private readonly sliceTransitionPort: SliceTransitionPort,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
    private readonly generateId: () => string,
    private readonly logger: LoggerPort,
  ) {}

  async execute(request: ShipRequest): Promise<Result<ShipResult, ShipError>> {
    const parsed = ShipRequestSchema.parse(request);

    // Step 0: Prerequisite check — worktree must exist for the slice to be in a shippable state
    const worktreeExists = await this.worktreePort.exists(parsed.sliceId);
    if (!worktreeExists) {
      return err(ShipError.prerequisiteFailed(parsed.sliceId, "worktree does not exist"));
    }

    // Step 1: Prerequisite check — resolve spec
    const specResult = await this.sliceSpecPort.getSpec(parsed.sliceId);
    if (!specResult.ok) {
      return err(ShipError.contextResolutionFailed(parsed.sliceId, specResult.error));
    }
    const spec = specResult.data;

    // Step 2: Idempotent PR creation
    const listResult = await this.gitHubPort.listPullRequests({
      head: parsed.headBranch,
      base: parsed.baseBranch,
      state: "open",
    });

    let prInfo: PullRequestInfo;

    if (listResult.ok && listResult.data.length > 0) {
      prInfo = listResult.data[0];
    } else {
      const createResult = await this.gitHubPort.createPullRequest({
        title: `[${spec.sliceLabel}] ${spec.sliceTitle}`,
        body: buildPRBody(spec),
        head: parsed.headBranch,
        base: parsed.baseBranch,
      });
      if (!createResult.ok) {
        return err(ShipError.prCreationFailed(parsed.sliceId, createResult.error));
      }
      prInfo = createResult.data;
    }

    const prNumber = prInfo.number;
    const prUrl = prInfo.url;

    // Step 3: Create and persist ship record
    const record = ShipRecord.createNew({
      id: this.generateId(),
      sliceId: parsed.sliceId,
      prNumber,
      prUrl,
      headBranch: parsed.headBranch,
      baseBranch: parsed.baseBranch,
      now: this.dateProvider.now(),
    });
    await this.shipRecordRepository.save(record);

    // Step 4: Merge gate loop
    let cycle = 0;
    let lastError: string | undefined;

    while (true) {
      const decision = await this.mergeGatePort.askMergeStatus({
        subjectId: parsed.sliceId,
        subjectLabel: spec.sliceLabel,
        prUrl,
        prNumber,
        cycle,
        lastError,
      });

      if (decision === "merged") {
        break;
      }

      if (decision === "abort") {
        record.recordAbort(this.dateProvider.now());
        await this.shipRecordRepository.save(record);
        return err(ShipError.mergeDeclined(parsed.sliceId));
      }

      // decision === "needs_changes"
      if (cycle < parsed.maxFixCycles) {
        lastError = await this.runFixCycle(parsed, cycle);
        cycle++;
      } else {
        // Max fix cycles exhausted — increment cycle and re-ask once more (forced decide)
        cycle++;
      }
    }

    // Step 5: Cleanup (best-effort for worktree, hard fail for transition)
    const worktreeResult = await this.worktreePort.delete(parsed.sliceId);
    if (!worktreeResult.ok) {
      this.logger.warn("Worktree cleanup failed", {
        sliceId: parsed.sliceId,
        error: worktreeResult.error.message,
      });
    }

    const transitionResult = await this.sliceTransitionPort.transition(parsed.sliceId, "closed");
    if (!transitionResult.ok) {
      return err(ShipError.cleanupFailed(parsed.sliceId, transitionResult.error));
    }

    // Step 6: Record merge and save
    record.recordMerge(cycle, this.dateProvider.now());
    await this.shipRecordRepository.save(record);

    // Step 7: Emit event
    await this.eventBus.publish(
      new SliceShippedEvent({
        id: this.generateId(),
        aggregateId: parsed.sliceId,
        occurredAt: this.dateProvider.now(),
        sliceId: parsed.sliceId,
        prNumber,
        prUrl,
        fixCyclesUsed: cycle,
      }),
    );

    // Step 8: Return result
    return ok({
      sliceId: parsed.sliceId,
      prNumber,
      prUrl,
      fixCyclesUsed: cycle,
      merged: true,
    });
  }

  /**
   * Runs a single fix cycle: review -> extract findings -> fix -> push.
   * Returns undefined on success, or an error message string on failure.
   */
  private async runFixCycle(parsed: ShipRequest, cycle: number): Promise<string | undefined> {
    // Run review with maxFixCycles: 0 (no internal fix loops)
    const reviewResult = await this.conductReview.execute({
      sliceId: parsed.sliceId,
      workingDirectory: parsed.workingDirectory,
      maxFixCycles: 0,
      timeoutMs: 120_000,
    });

    if (reviewResult.ok) {
      const mergedFindings = reviewResult.data.mergedReview.findings;
      const findings: FindingProps[] = mergedFindings.map(toFindingProps);

      if (findings.length > 0) {
        const fixResult = await this.fixerPort.fix({
          sliceId: parsed.sliceId,
          findings,
          workingDirectory: parsed.workingDirectory,
        });

        if (!fixResult.ok) {
          this.logger.warn("Fixer failed during fix cycle", {
            cycle,
            error: fixResult.error.message,
          });
          return fixResult.error.message;
        }
      }
    }

    // Push changes
    const pushResult = await this.gitPort.pushFrom(parsed.workingDirectory, parsed.headBranch);

    if (!pushResult.ok) {
      this.logger.warn("Push failed during fix cycle", {
        cycle,
        error: pushResult.error.message,
      });
      return pushResult.error.message;
    }

    return undefined;
  }
}

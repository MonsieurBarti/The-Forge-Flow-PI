import { join } from "node:path";
import { err, ok, type Result } from "@kernel";
import type { DateProviderPort, EventBusPort, LoggerPort } from "@kernel/ports";
import type { GitPort } from "@kernel/ports/git.port";
import type { GitHubPort } from "@kernel/ports/github.port";
import type { PullRequestInfo } from "@kernel/ports/github.schemas";
import type { StateSyncPort } from "@kernel/ports/state-sync.port";
import { CompletionRecord } from "../domain/aggregates/completion-record.aggregate";
import { CompleteMilestoneError } from "../domain/errors/complete-milestone.error";
import { MilestoneCompletedEvent } from "../domain/events/milestone-completed.event";
import type { CompletionRecordRepositoryPort } from "../domain/ports/completion-record-repository.port";
import type { MergeGatePort } from "../domain/ports/merge-gate.port";
import type { MilestoneAuditRecordRepositoryPort } from "../domain/ports/milestone-audit-record-repository.port";
import type { MilestoneQueryPort } from "../domain/ports/milestone-query.port";
import type { MilestoneTransitionPort } from "../domain/ports/milestone-transition.port";
import {
  type AuditReportProps,
  type CompleteMilestoneRequest,
  CompleteMilestoneRequestSchema,
  type CompleteMilestoneResult,
} from "../domain/schemas/completion.schemas";

export const DIFF_SIZE_LIMIT = 100_000;

export function truncateDiff(rawDiff: string): string {
  return `${rawDiff.slice(0, DIFF_SIZE_LIMIT)}\n\n[... diff truncated at 100KB ...]`;
}

export function buildMilestonePRBody(auditReports: AuditReportProps[]): string {
  const sections = auditReports.map((report) => {
    const title = report.agentType === "tff-spec-reviewer" ? "Intent Audit" : "Security Audit";
    return `## ${title}\n**Verdict:** ${report.verdict} | Findings: ${report.findings.length}\n\n${report.summary}`;
  });
  return sections.join("\n\n---\n\n");
}

export class CompleteMilestoneUseCase {
  constructor(
    private readonly milestoneQueryPort: MilestoneQueryPort,
    private readonly auditRecordRepo: MilestoneAuditRecordRepositoryPort,
    private readonly gitHubPort: GitHubPort,
    private readonly mergeGatePort: MergeGatePort,
    private readonly completionRecordRepository: CompletionRecordRepositoryPort,
    private readonly gitPort: GitPort,
    private readonly milestoneTransitionPort: MilestoneTransitionPort,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
    private readonly generateId: () => string,
    private readonly logger: LoggerPort,
    private readonly stateSyncPort?: StateSyncPort,
    private readonly mapCodebase?: {
      execute: (input: {
        tffDir: string;
        workingDirectory: string;
        mode: "full" | "incremental";
        milestoneLabel?: string;
        baseBranch?: string;
        headBranch?: string;
      }) => Promise<Result<unknown, unknown>>;
    },
  ) {}

  async execute(
    request: CompleteMilestoneRequest,
  ): Promise<Result<CompleteMilestoneResult, CompleteMilestoneError>> {
    // Step 0: Parse
    const parsed = CompleteMilestoneRequestSchema.parse(request);

    // Step 1: Guard — all slices closed + milestone in_progress
    const sliceStatusResult = await this.milestoneQueryPort.getSliceStatuses(parsed.milestoneId);
    if (!sliceStatusResult.ok) {
      return err(
        CompleteMilestoneError.auditFailed(parsed.milestoneId, sliceStatusResult.error.message),
      );
    }
    const unclosed = sliceStatusResult.data.filter((s) => s.status !== "closed");
    if (unclosed.length > 0) {
      return err(
        CompleteMilestoneError.openSlicesRemaining(
          parsed.milestoneId,
          unclosed.map((s) => ({ label: s.sliceLabel, status: s.status })),
        ),
      );
    }

    const milestoneStatusResult = await this.milestoneQueryPort.getMilestoneStatus(
      parsed.milestoneId,
    );
    if (!milestoneStatusResult.ok) {
      return err(
        CompleteMilestoneError.auditFailed(parsed.milestoneId, milestoneStatusResult.error.message),
      );
    }
    if (milestoneStatusResult.data !== "in_progress") {
      return err(
        CompleteMilestoneError.invalidMilestoneStatus(
          parsed.milestoneId,
          milestoneStatusResult.data,
        ),
      );
    }

    // Step 2: Check for passing audit record
    const auditResult = await this.auditRecordRepo.findLatestByMilestoneId(parsed.milestoneId);
    if (!auditResult.ok) {
      return err(
        CompleteMilestoneError.auditRequired(parsed.milestoneId, "Failed to query audit records"),
      );
    }
    if (!auditResult.data?.allPassed) {
      return err(CompleteMilestoneError.auditRequired(parsed.milestoneId));
    }
    const auditReports: AuditReportProps[] = auditResult.data.auditReports;

    // Step 3: Idempotent PR creation
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
        title: `[${parsed.milestoneLabel}] ${parsed.milestoneTitle}`,
        body: buildMilestonePRBody(auditReports),
        head: parsed.headBranch,
        base: parsed.baseBranch,
      });
      if (!createResult.ok) {
        return err(CompleteMilestoneError.prCreationFailed(parsed.milestoneId, createResult.error));
      }
      prInfo = createResult.data;
    }

    const prNumber = prInfo.number;
    const prUrl = prInfo.url;

    // Step 4: Create & persist CompletionRecord
    const record = CompletionRecord.createNew({
      id: this.generateId(),
      milestoneId: parsed.milestoneId,
      milestoneLabel: parsed.milestoneLabel,
      prNumber,
      prUrl,
      headBranch: parsed.headBranch,
      baseBranch: parsed.baseBranch,
      auditReports,
      now: this.dateProvider.now(),
    });
    await this.completionRecordRepository.save(record);

    // Step 5: Merge gate loop
    let cycle = 0;
    let lastError: string | undefined;

    while (true) {
      const decision = await this.mergeGatePort.askMergeStatus({
        subjectId: parsed.milestoneId,
        subjectLabel: parsed.milestoneLabel,
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
        await this.completionRecordRepository.save(record);
        return err(CompleteMilestoneError.mergeDeclined(parsed.milestoneId));
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

    // Step 5.5: State merge-back (hard fail)
    if (this.stateSyncPort) {
      const milestoneCodeBranch = parsed.headBranch;
      const defaultBranch = parsed.baseBranch;
      const tffDir = join(parsed.workingDirectory, ".tff");

      const syncResult = await this.stateSyncPort.syncToStateBranch(milestoneCodeBranch, tffDir);
      if (!syncResult.ok)
        return err(CompleteMilestoneError.mergeBackFailed(parsed.milestoneId, syncResult.error));

      const mergeResult = await this.stateSyncPort.mergeStateBranches(
        milestoneCodeBranch,
        defaultBranch,
        parsed.milestoneId,
      );
      if (!mergeResult.ok)
        return err(CompleteMilestoneError.mergeBackFailed(parsed.milestoneId, mergeResult.error));

      const deleteResult = await this.stateSyncPort.deleteStateBranch(milestoneCodeBranch);
      if (!deleteResult.ok)
        return err(CompleteMilestoneError.mergeBackFailed(parsed.milestoneId, deleteResult.error));

      const restoreResult = await this.stateSyncPort.restoreFromStateBranch(defaultBranch, tffDir);
      if (!restoreResult.ok)
        return err(CompleteMilestoneError.mergeBackFailed(parsed.milestoneId, restoreResult.error));
    }

    // Step 6: Post-merge cleanup (best-effort)
    const branchListResult = await this.gitPort.listBranches(`slice/${parsed.milestoneLabel}-*`);
    if (branchListResult.ok) {
      for (const branch of branchListResult.data) {
        const deleteResult = await this.gitPort.deleteBranch(branch);
        if (!deleteResult.ok) {
          this.logger.warn("Failed to delete stale slice branch", {
            branch,
            error: deleteResult.error.message,
          });
        }
      }
    }

    const milestoneDelResult = await this.gitPort.deleteBranch(parsed.headBranch);
    if (!milestoneDelResult.ok) {
      this.logger.warn("Failed to delete milestone branch", {
        branch: parsed.headBranch,
        error: milestoneDelResult.error.message,
      });
    }

    // Step 7: Close milestone
    const transitionResult = await this.milestoneTransitionPort.close(parsed.milestoneId);
    if (!transitionResult.ok) {
      return err(CompleteMilestoneError.cleanupFailed(parsed.milestoneId, transitionResult.error));
    }

    // Step 8: Record merge, save
    record.recordMerge(cycle, this.dateProvider.now());
    await this.completionRecordRepository.save(record);

    // Step 8.5: Incremental codebase documentation (best-effort)
    if (this.mapCodebase) {
      try {
        await this.mapCodebase.execute({
          tffDir: join(parsed.workingDirectory, ".tff"),
          workingDirectory: parsed.workingDirectory,
          mode: "incremental",
          milestoneLabel: parsed.milestoneLabel,
          baseBranch: parsed.baseBranch,
          headBranch: parsed.headBranch,
        });
      } catch (e) {
        this.logger.warn("Incremental doc update failed", { error: String(e) });
      }
    }

    // Step 9: Emit event
    await this.eventBus.publish(
      new MilestoneCompletedEvent({
        id: this.generateId(),
        aggregateId: parsed.milestoneId,
        occurredAt: this.dateProvider.now(),
        milestoneId: parsed.milestoneId,
        milestoneLabel: parsed.milestoneLabel,
        prNumber,
        prUrl,
        fixCyclesUsed: cycle,
        auditVerdicts: auditReports.map((r) => ({ agentType: r.agentType, verdict: r.verdict })),
      }),
    );

    // Step 10: Return result
    return ok({
      milestoneId: parsed.milestoneId,
      prNumber,
      prUrl,
      fixCyclesUsed: cycle,
      merged: true,
      auditReports,
    });
  }

  private async runFixCycle(
    parsed: CompleteMilestoneRequest,
    _cycle: number,
  ): Promise<string | undefined> {
    // Audit is now a pre-gate (/tff:audit-milestone). Fix cycles only push changes.
    const pushResult = await this.gitPort.pushFrom(parsed.workingDirectory, parsed.headBranch);
    if (!pushResult.ok) {
      this.logger.warn("Push failed during fix cycle", {
        cycle: _cycle,
        error: pushResult.error.message,
      });
      return pushResult.error.message;
    }

    return undefined;
  }
}

import { BaseDomainError, err, ok, type Result } from "@kernel";
import type { DateProviderPort } from "@kernel/ports";
import type { GitPort } from "@kernel/ports/git.port";
import { MilestoneAuditRecord } from "../domain/aggregates/milestone-audit-record.aggregate";
import type { AuditPort } from "../domain/ports/audit.port";
import type { MilestoneAuditRecordRepositoryPort } from "../domain/ports/milestone-audit-record-repository.port";
import type { MilestoneQueryPort } from "../domain/ports/milestone-query.port";
import type { AuditReportProps } from "../domain/schemas/completion.schemas";

export const DIFF_SIZE_LIMIT = 100_000;

export interface AuditMilestoneInput {
  milestoneId: string;
  milestoneLabel: string;
  headBranch: string;
  baseBranch: string;
  workingDirectory: string;
}

export interface AuditMilestoneOutput {
  milestoneId: string;
  milestoneLabel: string;
  auditReports: AuditReportProps[];
  allPassed: boolean;
  unresolvedCount: number;
  auditedAt: string;
}

export class AuditMilestoneError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static openSlicesRemaining(
    milestoneId: string,
    unclosed: { label: string; status: string }[],
  ): AuditMilestoneError {
    return new AuditMilestoneError(
      "AUDIT.OPEN_SLICES_REMAINING",
      `Cannot audit: ${unclosed.length} slice(s) not closed`,
      { milestoneId, unclosed },
    );
  }

  static invalidMilestoneStatus(milestoneId: string, status: string): AuditMilestoneError {
    return new AuditMilestoneError(
      "AUDIT.INVALID_MILESTONE_STATUS",
      `Milestone must be in_progress, got: ${status}`,
      { milestoneId, status },
    );
  }

  static failed(milestoneId: string, reason: string): AuditMilestoneError {
    return new AuditMilestoneError("AUDIT.FAILED", `Audit failed: ${reason}`, { milestoneId });
  }
}

export class AuditMilestoneUseCase {
  constructor(
    private readonly milestoneQuery: MilestoneQueryPort,
    private readonly auditPort: AuditPort,
    private readonly auditRecordRepo: MilestoneAuditRecordRepositoryPort,
    private readonly gitPort: GitPort,
    private readonly dateProvider: DateProviderPort,
    private readonly generateId: () => string,
  ) {}

  async execute(
    input: AuditMilestoneInput,
  ): Promise<Result<AuditMilestoneOutput, AuditMilestoneError>> {
    // 1. Guard: all slices closed
    const sliceStatusResult = await this.milestoneQuery.getSliceStatuses(input.milestoneId);
    if (!sliceStatusResult.ok) {
      return err(AuditMilestoneError.failed(input.milestoneId, sliceStatusResult.error.message));
    }
    const unclosed = sliceStatusResult.data.filter((s) => s.status !== "closed");
    if (unclosed.length > 0) {
      return err(
        AuditMilestoneError.openSlicesRemaining(
          input.milestoneId,
          unclosed.map((s) => ({ label: s.sliceLabel, status: s.status })),
        ),
      );
    }

    // 2. Guard: milestone in_progress
    const msStatusResult = await this.milestoneQuery.getMilestoneStatus(input.milestoneId);
    if (!msStatusResult.ok) {
      return err(AuditMilestoneError.failed(input.milestoneId, msStatusResult.error.message));
    }
    if (msStatusResult.data !== "in_progress") {
      return err(
        AuditMilestoneError.invalidMilestoneStatus(input.milestoneId, msStatusResult.data),
      );
    }

    // 3. Compute diff + load requirements
    const reqResult = await this.milestoneQuery.getRequirementsContent(input.milestoneLabel);
    if (!reqResult.ok) {
      return err(AuditMilestoneError.failed(input.milestoneId, reqResult.error.message));
    }

    const diffResult = await this.gitPort.diffAgainst(input.baseBranch, input.workingDirectory);
    if (!diffResult.ok) {
      return err(AuditMilestoneError.failed(input.milestoneId, diffResult.error.message));
    }

    const rawDiff = diffResult.data;
    const diffContent =
      rawDiff.length > DIFF_SIZE_LIMIT
        ? `${rawDiff.slice(0, DIFF_SIZE_LIMIT)}\n\n[... diff truncated at 100KB ...]`
        : rawDiff;

    // 4. Parallel audit dispatch
    const [intentResult, securityResult] = await Promise.all([
      this.auditPort.auditMilestone({
        milestoneLabel: input.milestoneLabel,
        requirementsContent: reqResult.data,
        diffContent,
        agentType: "tff-spec-reviewer",
      }),
      this.auditPort.auditMilestone({
        milestoneLabel: input.milestoneLabel,
        requirementsContent: reqResult.data,
        diffContent,
        agentType: "tff-security-auditor",
      }),
    ]);

    if (!intentResult.ok) {
      return err(AuditMilestoneError.failed(input.milestoneId, intentResult.error.message));
    }
    if (!securityResult.ok) {
      return err(AuditMilestoneError.failed(input.milestoneId, securityResult.error.message));
    }

    const auditReports: AuditReportProps[] = [intentResult.data, securityResult.data];

    // 5. Persist audit record
    const now = this.dateProvider.now();
    const record = MilestoneAuditRecord.createNew({
      id: this.generateId(),
      milestoneId: input.milestoneId,
      milestoneLabel: input.milestoneLabel,
      auditReports,
      now,
    });

    const saveResult = await this.auditRecordRepo.save(record);
    if (!saveResult.ok) {
      return err(AuditMilestoneError.failed(input.milestoneId, "Failed to persist audit record"));
    }

    return ok({
      milestoneId: input.milestoneId,
      milestoneLabel: input.milestoneLabel,
      auditReports,
      allPassed: record.allPassed,
      unresolvedCount: record.unresolvedCount,
      auditedAt: now.toISOString(),
    });
  }
}

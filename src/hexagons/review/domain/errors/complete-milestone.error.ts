import { BaseDomainError } from "@kernel";

export class CompleteMilestoneError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static openSlicesRemaining(
    milestoneId: string,
    unclosed: { label: string; status: string }[],
  ): CompleteMilestoneError {
    return new CompleteMilestoneError(
      "MILESTONE.OPEN_SLICES_REMAINING",
      `Cannot complete milestone ${milestoneId}: ${unclosed.length} slice(s) not closed`,
      { milestoneId, unclosed },
    );
  }

  static invalidMilestoneStatus(
    milestoneId: string,
    currentStatus: string,
  ): CompleteMilestoneError {
    return new CompleteMilestoneError(
      "MILESTONE.INVALID_STATUS",
      `Milestone ${milestoneId} is "${currentStatus}", expected "in_progress"`,
      { milestoneId, currentStatus },
    );
  }

  static auditFailed(milestoneId: string, reason: string): CompleteMilestoneError {
    return new CompleteMilestoneError(
      "MILESTONE.AUDIT_FAILED",
      `Audit failed for milestone ${milestoneId}: ${reason}`,
      { milestoneId, reason },
    );
  }

  static prCreationFailed(milestoneId: string, cause: unknown): CompleteMilestoneError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new CompleteMilestoneError(
      "MILESTONE.PR_CREATION_FAILED",
      `PR creation failed for milestone ${milestoneId}: ${msg}`,
      { milestoneId, cause: msg },
    );
  }

  static mergeDeclined(milestoneId: string): CompleteMilestoneError {
    return new CompleteMilestoneError(
      "MILESTONE.MERGE_DECLINED",
      `Merge was declined for milestone ${milestoneId}`,
      { milestoneId },
    );
  }

  static cleanupFailed(milestoneId: string, cause: unknown): CompleteMilestoneError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new CompleteMilestoneError(
      "MILESTONE.CLEANUP_FAILED",
      `Cleanup failed for milestone ${milestoneId}: ${msg}`,
      { milestoneId, cause: msg },
    );
  }
}

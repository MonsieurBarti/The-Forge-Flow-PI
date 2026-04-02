import { BaseDomainError } from "@kernel";

export class MilestoneQueryError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static notFound(milestoneId: string): MilestoneQueryError {
    return new MilestoneQueryError(
      "MILESTONE_QUERY.NOT_FOUND",
      `Milestone "${milestoneId}" not found`,
      { milestoneId },
    );
  }

  static queryFailed(milestoneId: string, cause: unknown): MilestoneQueryError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new MilestoneQueryError(
      "MILESTONE_QUERY.QUERY_FAILED",
      `Query failed for milestone "${milestoneId}": ${msg}`,
      { milestoneId, cause: msg },
    );
  }
}

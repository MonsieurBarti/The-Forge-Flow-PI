import { BaseDomainError } from "@kernel";

export class MilestoneTransitionError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static notFound(milestoneId: string): MilestoneTransitionError {
    return new MilestoneTransitionError(
      "MILESTONE_TRANSITION.NOT_FOUND",
      `Milestone "${milestoneId}" not found`,
      { milestoneId },
    );
  }

  static invalidTransition(milestoneId: string, currentStatus: string): MilestoneTransitionError {
    return new MilestoneTransitionError(
      "MILESTONE_TRANSITION.INVALID_TRANSITION",
      `Cannot close milestone "${milestoneId}": current status is "${currentStatus}"`,
      { milestoneId, currentStatus },
    );
  }
}

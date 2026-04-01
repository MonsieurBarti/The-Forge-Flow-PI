import { BaseDomainError } from "@kernel";
import type { ReviewRole } from "../review.schemas";

export class ConductReviewError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static contextResolutionFailed(sliceId: string, cause: unknown): ConductReviewError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ConductReviewError(
      "REVIEW.CONTEXT_RESOLUTION_FAILED",
      `Failed to resolve review context for slice ${sliceId}: ${msg}`,
      { sliceId, cause: msg },
    );
  }

  static allReviewersFailed(
    sliceId: string,
    failures: Array<{ role: string; cause: string }>,
  ): ConductReviewError {
    return new ConductReviewError(
      "REVIEW.ALL_REVIEWERS_FAILED",
      `All reviewers failed for slice ${sliceId} after retry`,
      { sliceId, failures },
    );
  }

  static reviewerRetryExhausted(
    sliceId: string,
    role: ReviewRole,
    cause: unknown,
  ): ConductReviewError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ConductReviewError(
      "REVIEW.REVIEWER_RETRY_EXHAUSTED",
      `Reviewer ${role} failed for slice ${sliceId} after retry: ${msg}`,
      { sliceId, role, cause: msg },
    );
  }

  static freshReviewerBlocked(
    sliceId: string,
    role: ReviewRole,
    reviewerId: string,
  ): ConductReviewError {
    return new ConductReviewError(
      "REVIEW.FRESH_REVIEWER_BLOCKED",
      `Fresh-reviewer violation: ${reviewerId} cannot review slice ${sliceId} as ${role}`,
      { sliceId, role, reviewerId },
    );
  }

  static mergeError(sliceId: string, cause: unknown): ConductReviewError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ConductReviewError(
      "REVIEW.MERGE_FAILED",
      `Failed to merge reviews for slice ${sliceId}: ${msg}`,
      { sliceId, cause: msg },
    );
  }
}

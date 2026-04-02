import { BaseDomainError } from "@kernel";

export class FreshReviewerViolationError extends BaseDomainError {
  readonly code = "REVIEW.FRESH_REVIEWER_VIOLATION";

  constructor(reviewerId: string, sliceId: string, executors: ReadonlySet<string>) {
    super(`Reviewer "${reviewerId}" was also an executor for slice "${sliceId}"`, {
      reviewerId,
      sliceId,
      executors: [...executors],
    });
  }
}

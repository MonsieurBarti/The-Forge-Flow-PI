// Domain -- Errors
export { ExecutorQueryError } from "./domain/errors/executor-query.error";
export { FreshReviewerViolationError } from "./domain/errors/fresh-reviewer-violation.error";
// Domain -- Events
export { ReviewRecordedEvent } from "./domain/events/review-recorded.event";
// Domain -- Builders
export { FindingBuilder } from "./domain/finding.builder";
export type {
  ConflictProps,
  MergedFindingProps,
  MergedReviewProps,
} from "./domain/merged-review.schemas";
export {
  ConflictPropsSchema,
  MergedFindingPropsSchema,
  MergedReviewPropsSchema,
} from "./domain/merged-review.schemas";
export { MergedReview, MergeValidationError } from "./domain/merged-review.vo";
// Domain -- Ports
export { ExecutorQueryPort } from "./domain/ports/executor-query.port";
export { ReviewRepositoryPort } from "./domain/ports/review-repository.port";
// Domain -- Aggregates & Value Objects
export { Review } from "./domain/review.aggregate";
export { ReviewBuilder } from "./domain/review.builder";
// Domain -- Schemas (types)
export type {
  FindingProps,
  ReviewProps,
  ReviewRole,
  ReviewSeverity,
  ReviewVerdict,
} from "./domain/review.schemas";
// Domain -- Schemas (values)
export {
  FindingPropsSchema,
  ReviewPropsSchema,
  ReviewRoleSchema,
  ReviewSeveritySchema,
  ReviewVerdictSchema,
  SEVERITY_RANK,
} from "./domain/review.schemas";
// Domain -- Services
export { FreshReviewerService } from "./domain/services/fresh-reviewer.service";

// Infrastructure -- Adapters
export { CachedExecutorQueryAdapter } from "./infrastructure/cached-executor-query.adapter";
export { InMemoryReviewRepository } from "./infrastructure/in-memory-review.repository";
export { SqliteReviewRepository } from "./infrastructure/sqlite-review.repository";

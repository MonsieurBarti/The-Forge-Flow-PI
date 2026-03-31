// Domain -- Errors

export type { ReviewPromptConfig } from "./application/review-prompt-builder";
// Application
export { ReviewPromptBuilder } from "./application/review-prompt-builder";
// Domain -- Builders
export { CritiqueReflectionResultBuilder } from "./domain/critique-reflection.builder";
// Domain -- Schemas (types)
export type {
  CritiquePassResult,
  CritiqueReflectionResult,
  ProcessedReviewResult,
  ReflectionInsight,
  ReflectionPassResult,
} from "./domain/critique-reflection.schemas";
export {
  CritiquePassResultSchema,
  CritiqueReflectionResultSchema,
  ProcessedReviewResultSchema,
  ReflectionInsightSchema,
  ReflectionPassResultSchema,
} from "./domain/critique-reflection.schemas";
export { CritiqueReflectionError } from "./domain/errors/critique-reflection.error";
export { ExecutorQueryError } from "./domain/errors/executor-query.error";
export { FreshReviewerViolationError } from "./domain/errors/fresh-reviewer-violation.error";
// Domain -- Events
export { ReviewRecordedEvent } from "./domain/events/review-recorded.event";
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
export type {
  FindingImpact,
  FindingProps,
  ReviewProps,
  ReviewRole,
  ReviewSeverity,
  ReviewStrategy,
  ReviewVerdict,
} from "./domain/review.schemas";
// Domain -- Schemas (values)
export {
  FindingImpactSchema,
  FindingPropsSchema,
  ReviewPropsSchema,
  ReviewRoleSchema,
  ReviewSeveritySchema,
  ReviewStrategySchema,
  ReviewVerdictSchema,
  SEVERITY_RANK,
} from "./domain/review.schemas";
// Domain -- Strategy
export { strategyForRole } from "./domain/review-strategy";
// Domain -- Services
export { CritiqueReflectionService } from "./domain/services/critique-reflection.service";
export { FreshReviewerService } from "./domain/services/fresh-reviewer.service";

// Infrastructure -- Adapters
export { CachedExecutorQueryAdapter } from "./infrastructure/cached-executor-query.adapter";
export { InMemoryReviewRepository } from "./infrastructure/in-memory-review.repository";
export { SqliteReviewRepository } from "./infrastructure/sqlite-review.repository";

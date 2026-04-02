// Domain -- Errors

// Application — ConductReview
export { ConductReviewUseCase } from "./application/conduct-review.use-case";
export type { ReviewPromptConfig } from "./application/review-prompt-builder";
// Application
export { ReviewPromptBuilder } from "./application/review-prompt-builder";
// Application — Ship
export { ShipSliceUseCase } from "./application/ship-slice.use-case";
// Application — Verify
export { VerifyAcceptanceCriteriaUseCase } from "./application/verify-acceptance-criteria.use-case";
// Domain — ConductReview schemas
export type { ConductReviewRequest, ConductReviewResult } from "./domain/conduct-review.schemas";
export {
  ConductReviewRequestSchema,
  ConductReviewResultSchema,
} from "./domain/conduct-review.schemas";
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
// Domain — New Errors
export { ConductReviewError } from "./domain/errors/conduct-review.error";
export { CritiqueReflectionError } from "./domain/errors/critique-reflection.error";
export { ExecutorQueryError } from "./domain/errors/executor-query.error";
export { FixerError } from "./domain/errors/fixer.error";
export { FreshReviewerViolationError } from "./domain/errors/fresh-reviewer-violation.error";
export { ChangedFilesError, SliceSpecError } from "./domain/errors/review-context.error";
// Domain — ReviewUI Errors
export { ReviewUIError } from "./domain/errors/review-ui.error";
export { ShipError } from "./domain/errors/ship.error";
export { VerifyError } from "./domain/errors/verify.error";
// Domain — New Events
export { ReviewPipelineCompletedEvent } from "./domain/events/review-pipeline-completed.event";
// Domain -- Events
export { ReviewRecordedEvent } from "./domain/events/review-recorded.event";
// Domain — Ship Events
export { SliceShippedEvent } from "./domain/events/slice-shipped.event";
export { VerificationCompletedEvent } from "./domain/events/verification-completed.event";
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
export { ChangedFilesPort } from "./domain/ports/changed-files.port";
// Domain -- Ports
export { ExecutorQueryPort } from "./domain/ports/executor-query.port";
export type { FixRequest, FixResult } from "./domain/ports/fixer.port";
export { FixerPort, FixRequestSchema, FixResultSchema } from "./domain/ports/fixer.port";
export type { MergeGateContext } from "./domain/ports/merge-gate.port";
// Domain — Ship Ports
export { MergeGatePort } from "./domain/ports/merge-gate.port";
export { ReviewRepositoryPort } from "./domain/ports/review-repository.port";
// Domain — ReviewUI Port
export { ReviewUIPort } from "./domain/ports/review-ui.port";
export { ShipRecordRepositoryPort } from "./domain/ports/ship-record-repository.port";
export type { SliceSpec } from "./domain/ports/slice-spec.port";
// Domain — New Ports
export { SliceSpecPort, SliceSpecSchema } from "./domain/ports/slice-spec.port";
export { VerificationRepositoryPort } from "./domain/ports/verification-repository.port";
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
// Domain — ReviewUI Schemas
export type {
  ApprovalUIContext,
  ApprovalUIResponse,
  FindingsUIContext,
  FindingsUIResponse,
  VerificationUIContext,
  VerificationUIResponse,
} from "./domain/review-ui.schemas";
export {
  ApprovalUIContextSchema,
  ApprovalUIResponseSchema,
  FindingsUIContextSchema,
  FindingsUIResponseSchema,
  VerificationUIContextSchema,
  VerificationUIResponseSchema,
} from "./domain/review-ui.schemas";
// Domain -- Services
export { CritiqueReflectionService } from "./domain/services/critique-reflection.service";
export { FreshReviewerService } from "./domain/services/fresh-reviewer.service";
// Domain — Ship schemas
export type {
  MergeGateDecision,
  ShipRecordProps,
  ShipRequest,
  ShipResult,
} from "./domain/ship.schemas";
export {
  MergeGateDecisionSchema,
  ShipRecordPropsSchema,
  ShipRequestSchema,
  ShipResultSchema,
} from "./domain/ship.schemas";
// Domain — ShipRecord aggregate
export { ShipRecord } from "./domain/ship-record.aggregate";
// Domain — Verification
export { Verification } from "./domain/verification.aggregate";
export type {
  CriterionVerdictProps,
  VerificationProps,
  VerificationVerdict,
  VerifyRequest,
  VerifyResult,
} from "./domain/verification.schemas";
export {
  CriterionVerdictSchema,
  VerificationPropsSchema,
  VerificationVerdictSchema,
  VerifyRequestSchema,
  VerifyResultSchema,
} from "./domain/verification.schemas";
export { BeadSliceSpecAdapter } from "./infrastructure/bead-slice-spec.adapter";
// Infrastructure -- Adapters
export { CachedExecutorQueryAdapter } from "./infrastructure/cached-executor-query.adapter";
export { GitChangedFilesAdapter } from "./infrastructure/git-changed-files.adapter";
export { InMemoryReviewRepository } from "./infrastructure/in-memory-review.repository";
// Infrastructure — ReviewUI Adapters
export { InMemoryReviewUIAdapter } from "./infrastructure/in-memory-review-ui.adapter";
// Infrastructure — Ship
export { InMemoryShipRecordRepository } from "./infrastructure/in-memory-ship-record.repository";
// Infrastructure — Verification
export { InMemoryVerificationRepository } from "./infrastructure/in-memory-verification.repository";
export { PiMergeGateAdapter } from "./infrastructure/pi-merge-gate.adapter";
export { PlannotatorReviewUIAdapter } from "./infrastructure/plannotator-review-ui.adapter";
export { SqliteReviewRepository } from "./infrastructure/sqlite-review.repository";
export { SqliteShipRecordRepository } from "./infrastructure/sqlite-ship-record.repository";
export { SqliteVerificationRepository } from "./infrastructure/sqlite-verification.repository";
// Infrastructure — New Adapters
export { StubFixerAdapter } from "./infrastructure/stub-fixer.adapter";
export { TerminalReviewUIAdapter } from "./infrastructure/terminal-review-ui.adapter";

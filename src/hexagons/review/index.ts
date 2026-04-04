// Domain -- Errors

// Application — CompleteMilestone
export { CompleteMilestoneUseCase } from "./application/complete-milestone.use-case";
// Application — ConductReview
export { ConductReviewUseCase } from "./application/conduct-review.use-case";
export type { ReviewPromptConfig } from "./application/review-prompt-builder";
// Application
export { ReviewPromptBuilder } from "./application/review-prompt-builder";
// Application — Ship
export { ShipSliceUseCase } from "./application/ship-slice.use-case";
// Application — Verify
export { VerifyAcceptanceCriteriaUseCase } from "./application/verify-acceptance-criteria.use-case";
// Domain — CompleteMilestone Schemas
export type {
  AuditAgentType,
  AuditReportProps,
  AuditVerdict,
  CompleteMilestoneRequest,
  CompleteMilestoneResult,
  CompletionOutcome,
  CompletionRecordProps,
} from "./domain/schemas/completion.schemas";
export {
  AuditAgentTypeSchema,
  AuditReportSchema,
  AuditVerdictSchema,
  CompleteMilestoneRequestSchema,
  CompleteMilestoneResultSchema,
  CompletionOutcomeSchema,
  CompletionRecordPropsSchema,
} from "./domain/schemas/completion.schemas";
// Domain — CompletionRecord Aggregate
export { CompletionRecord } from "./domain/aggregates/completion-record.aggregate";
// Domain — ConductReview schemas
export type { ConductReviewRequest, ConductReviewResult } from "./domain/schemas/conduct-review.schemas";
export {
  ConductReviewRequestSchema,
  ConductReviewResultSchema,
} from "./domain/schemas/conduct-review.schemas";
// Domain -- Builders
export { CritiqueReflectionResultBuilder } from "./domain/builders/critique-reflection.builder";
// Domain -- Schemas (types)
export type {
  CritiquePassResult,
  CritiqueReflectionResult,
  ProcessedReviewResult,
  ReflectionInsight,
  ReflectionPassResult,
} from "./domain/schemas/critique-reflection.schemas";
export {
  CritiquePassResultSchema,
  CritiqueReflectionResultSchema,
  ProcessedReviewResultSchema,
  ReflectionInsightSchema,
  ReflectionPassResultSchema,
} from "./domain/schemas/critique-reflection.schemas";
// Domain — CompleteMilestone Errors
export { AuditError } from "./domain/errors/audit.error";
export { CompleteMilestoneError } from "./domain/errors/complete-milestone.error";
// Domain — New Errors
export { ConductReviewError } from "./domain/errors/conduct-review.error";
export { CritiqueReflectionError } from "./domain/errors/critique-reflection.error";
export { ExecutorQueryError } from "./domain/errors/executor-query.error";
export { FixerError } from "./domain/errors/fixer.error";
export { FreshReviewerViolationError } from "./domain/errors/fresh-reviewer-violation.error";
export { MilestoneQueryError } from "./domain/errors/milestone-query.error";
export { MilestoneTransitionError } from "./domain/errors/milestone-transition.error";
export { ChangedFilesError, SliceSpecError } from "./domain/errors/review-context.error";
// Domain — ReviewUI Errors
export { ReviewUIError } from "./domain/errors/review-ui.error";
export { ShipError } from "./domain/errors/ship.error";
export { VerifyError } from "./domain/errors/verify.error";
// Domain — CompleteMilestone Events
export { MilestoneCompletedEvent } from "./domain/events/milestone-completed.event";
// Domain — New Events
export { ReviewPipelineCompletedEvent } from "./domain/events/review-pipeline-completed.event";
// Domain -- Events
export { ReviewRecordedEvent } from "./domain/events/review-recorded.event";
// Domain — Ship Events
export { SliceShippedEvent } from "./domain/events/slice-shipped.event";
export { VerificationCompletedEvent } from "./domain/events/verification-completed.event";
export { FindingBuilder } from "./domain/builders/finding.builder";
export type {
  ConflictProps,
  MergedFindingProps,
  MergedReviewProps,
} from "./domain/schemas/merged-review.schemas";
export {
  ConflictPropsSchema,
  MergedFindingPropsSchema,
  MergedReviewPropsSchema,
} from "./domain/schemas/merged-review.schemas";
export { MergedReview, MergeValidationError } from "./domain/value-objects/merged-review.vo";
// Domain — CompleteMilestone Ports
export { AuditPort } from "./domain/ports/audit.port";
export { ChangedFilesPort } from "./domain/ports/changed-files.port";
export { CompletionRecordRepositoryPort } from "./domain/ports/completion-record-repository.port";
// Domain -- Ports
export { ExecutorQueryPort } from "./domain/ports/executor-query.port";
export type { FixRequest, FixResult } from "./domain/ports/fixer.port";
export { FixerPort, FixRequestSchema, FixResultSchema } from "./domain/ports/fixer.port";
export type { MergeGateContext } from "./domain/ports/merge-gate.port";
// Domain — Ship Ports
export { MergeGatePort } from "./domain/ports/merge-gate.port";
export type { MilestoneSliceStatus } from "./domain/ports/milestone-query.port";
export { MilestoneQueryPort } from "./domain/ports/milestone-query.port";
export { MilestoneTransitionPort } from "./domain/ports/milestone-transition.port";
export { ReviewRepositoryPort } from "./domain/ports/review-repository.port";
// Domain — ReviewUI Port
export { ReviewUIPort } from "./domain/ports/review-ui.port";
export { ShipRecordRepositoryPort } from "./domain/ports/ship-record-repository.port";
export type { SliceSpec } from "./domain/ports/slice-spec.port";
// Domain — New Ports
export { SliceSpecPort, SliceSpecSchema } from "./domain/ports/slice-spec.port";
export { VerificationRepositoryPort } from "./domain/ports/verification-repository.port";
// Domain -- Aggregates & Value Objects
export { Review } from "./domain/aggregates/review.aggregate";
export { ReviewBuilder } from "./domain/builders/review.builder";
export type {
  FindingImpact,
  FindingProps,
  ReviewProps,
  ReviewRole,
  ReviewSeverity,
  ReviewStrategy,
  ReviewVerdict,
} from "./domain/schemas/review.schemas";
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
} from "./domain/schemas/review.schemas";
// Domain -- Strategy
export { strategyForRole } from "./domain/strategies/review-strategy";
// Domain — ReviewUI Schemas
export type {
  ApprovalUIContext,
  ApprovalUIResponse,
  FindingsUIContext,
  FindingsUIResponse,
  VerificationUIContext,
  VerificationUIResponse,
} from "./domain/schemas/review-ui.schemas";
export {
  ApprovalUIContextSchema,
  ApprovalUIResponseSchema,
  FindingsUIContextSchema,
  FindingsUIResponseSchema,
  VerificationUIContextSchema,
  VerificationUIResponseSchema,
} from "./domain/schemas/review-ui.schemas";
// Domain -- Services
export { CritiqueReflectionService } from "./domain/services/critique-reflection.service";
export { FreshReviewerService } from "./domain/services/fresh-reviewer.service";
// Domain — Ship schemas
export type {
  MergeGateDecision,
  ShipRecordProps,
  ShipRequest,
  ShipResult,
} from "./domain/schemas/ship.schemas";
export {
  MergeGateDecisionSchema,
  ShipRecordPropsSchema,
  ShipRequestSchema,
  ShipResultSchema,
} from "./domain/schemas/ship.schemas";
// Domain — ShipRecord aggregate
export { ShipRecord } from "./domain/aggregates/ship-record.aggregate";
// Domain — Verification
export { Verification } from "./domain/aggregates/verification.aggregate";
export type {
  CriterionVerdictProps,
  VerificationProps,
  VerificationVerdict,
  VerifyRequest,
  VerifyResult,
} from "./domain/schemas/verification.schemas";
export {
  CriterionVerdictSchema,
  VerificationPropsSchema,
  VerificationVerdictSchema,
  VerifyRequestSchema,
  VerifyResultSchema,
} from "./domain/schemas/verification.schemas";
export { BeadSliceSpecAdapter } from "./infrastructure/adapters/slice-spec/bead-slice-spec.adapter";
// Infrastructure -- Adapters
export { CachedExecutorQueryAdapter } from "./infrastructure/adapters/executor-query/cached-executor-query.adapter";
export { GitChangedFilesAdapter } from "./infrastructure/adapters/changed-files/git-changed-files.adapter";
// Infrastructure — CompleteMilestone
export { InMemoryCompletionRecordRepository } from "./infrastructure/repositories/completion-record/in-memory-completion-record.repository";
export { InMemoryReviewRepository } from "./infrastructure/repositories/review/in-memory-review.repository";
// Infrastructure — ReviewUI Adapters
export { InMemoryReviewUIAdapter } from "./infrastructure/adapters/review-ui/in-memory-review-ui.adapter";
// Infrastructure — Ship
export { InMemoryShipRecordRepository } from "./infrastructure/repositories/ship-record/in-memory-ship-record.repository";
// Infrastructure — Verification
export { InMemoryVerificationRepository } from "./infrastructure/repositories/verification/in-memory-verification.repository";
export { MilestoneQueryAdapter } from "./infrastructure/adapters/milestone/milestone-query.adapter";
export { MilestoneTransitionAdapter } from "./infrastructure/adapters/milestone/milestone-transition.adapter";
export { PiAuditAdapter } from "./infrastructure/adapters/audit/pi-audit.adapter";
export { PiMergeGateAdapter } from "./infrastructure/adapters/merge-gate/pi-merge-gate.adapter";
export { PlannotatorReviewUIAdapter } from "./infrastructure/adapters/review-ui/plannotator-review-ui.adapter";
export { SqliteCompletionRecordRepository } from "./infrastructure/repositories/completion-record/sqlite-completion-record.repository";
export { SqliteReviewRepository } from "./infrastructure/repositories/review/sqlite-review.repository";
export { SqliteShipRecordRepository } from "./infrastructure/repositories/ship-record/sqlite-ship-record.repository";
export { SqliteVerificationRepository } from "./infrastructure/repositories/verification/sqlite-verification.repository";
// Infrastructure — New Adapters
export { StubFixerAdapter } from "./infrastructure/adapters/fixer/stub-fixer.adapter";
export { TerminalReviewUIAdapter } from "./infrastructure/adapters/review-ui/terminal-review-ui.adapter";

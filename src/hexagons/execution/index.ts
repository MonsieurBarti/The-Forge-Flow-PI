// Application -- Use Cases

// Domain -- Ports
export { AgentDispatchError, AgentDispatchPort } from "@kernel/agents";
export { AggregateMetricsUseCase } from "./application/aggregate-metrics.use-case";
// Application -- Reflection
export { buildReflectionConfig } from "./application/build-reflection-config";
export type { BuildReflectionConfigParams } from "./application/build-reflection-config";
export { CleanupOrphanedWorktreesUseCase } from "./application/cleanup-orphaned-worktrees.use-case";
// Application -- Collaborators
export { DomainRouter } from "./application/domain-router";
export type { ExecuteSliceInput, ExecuteSliceResult } from "./application/execute-slice.schemas";
// Application -- Schemas
export {
  ExecuteSliceInputSchema,
  ExecuteSliceResultSchema,
} from "./application/execute-slice.schemas";
export { ExecuteSliceUseCase } from "./application/execute-slice.use-case";
// Application -- Coordinator
export type {
  ExecutionResult,
  PauseAcknowledgement,
  StartExecutionInput,
} from "./application/execution-coordinator.schemas";
export {
  ExecutionResultSchema,
  PauseAcknowledgementSchema,
  StartExecutionInputSchema,
} from "./application/execution-coordinator.schemas";
export {
  ExecutionCoordinator,
  type ExecutionCoordinatorDeps,
} from "./application/execution-coordinator.use-case";
// Application -- Queries
export { GetSliceExecutorsUseCase } from "./application/get-slice-executors.use-case";
export { JournalEventHandler } from "./application/journal-event-handler";
export type { PromptBuilderConfig, PromptBuilderTask } from "./application/prompt-builder";
export { PromptBuilder } from "./application/prompt-builder";
export { RecordTaskMetricsUseCase } from "./application/record-task-metrics.use-case";
export { ReplayJournalUseCase, type ReplayResult } from "./application/replay-journal.use-case";
export {
  type RollbackInput,
  type RollbackResult,
  RollbackSliceUseCase,
} from "./application/rollback-slice.use-case";
// Domain -- Aggregates (for downstream test wiring)
export { Checkpoint } from "./domain/checkpoint.aggregate";
// Domain -- Schemas
export type { CheckpointDTO, CheckpointProps, ExecutorLogEntry } from "./domain/checkpoint.schemas";
export { CheckpointPropsSchema, ExecutorLogEntrySchema } from "./domain/checkpoint.schemas";
// Domain -- Guardrail Context
export type { EnrichedGuardrailContext } from "./domain/enriched-guardrail-context";
export { CheckpointNotFoundError } from "./domain/errors/checkpoint-not-found.error";
export { ExecutionError } from "./domain/errors/execution.error";
// Domain -- Errors
export { GuardrailError } from "./domain/errors/guardrail.error";
export { InvalidCheckpointStateError } from "./domain/errors/invalid-checkpoint-state.error";
export { JournalReadError } from "./domain/errors/journal-read.error";
export { JournalReplayError } from "./domain/errors/journal-replay.error";
export { JournalWriteError } from "./domain/errors/journal-write.error";
// Domain -- Overseer Errors
export { OverseerError } from "./domain/errors/overseer.error";
export { RollbackError } from "./domain/errors/rollback.error";
export { WorktreeError } from "@kernel/errors/worktree.error";
// Domain -- Events
export { AllTasksCompletedEvent } from "./domain/events/all-tasks-completed.event";
export { CheckpointSavedEvent } from "./domain/events/checkpoint-saved.event";
// Domain -- ExecutionSession Events
export { ExecutionCompletedEvent } from "./domain/events/execution-completed.event";
export { ExecutionFailedEvent } from "./domain/events/execution-failed.event";
export { ExecutionPausedEvent } from "./domain/events/execution-paused.event";
export { ExecutionResumedEvent } from "./domain/events/execution-resumed.event";
export { ExecutionStartedEvent } from "./domain/events/execution-started.event";
export { TaskExecutionCompletedEvent } from "./domain/events/task-execution-completed.event";
// Domain -- ExecutionSession
export { ExecutionSession } from "./domain/execution-session.aggregate";
export type {
  ExecutionSessionProps,
  ExecutionSessionStatus,
} from "./domain/execution-session.schemas";
export {
  ExecutionSessionPropsSchema,
  ExecutionSessionStatusSchema,
} from "./domain/execution-session.schemas";
// Domain -- Guardrail Schemas
export type {
  GuardrailContext,
  GuardrailRuleId,
  GuardrailSeverity,
  GuardrailValidationReport,
  GuardrailViolation,
} from "./domain/guardrail.schemas";
export {
  GuardrailContextSchema,
  GuardrailRuleIdSchema,
  GuardrailSeveritySchema,
  GuardrailValidationReportSchema,
  GuardrailViolationSchema,
} from "./domain/guardrail.schemas";
// Domain -- Guardrail Rule Interface
export type { GuardrailRule } from "./domain/guardrail-rule";
// Domain -- Pre-dispatch
export { PreDispatchGuardrailPort } from "./domain/ports/pre-dispatch-guardrail.port";
export type { PreDispatchGuardrailRule } from "./domain/pre-dispatch-guardrail-rule";
export {
  PreDispatchContextSchema,
  PreDispatchViolationSchema,
  PreDispatchReportSchema,
} from "./domain/pre-dispatch.schemas";
export type {
  PreDispatchContext,
  PreDispatchViolation,
  PreDispatchReport,
} from "./domain/pre-dispatch.schemas";
// Domain -- Reflection + Fallback
export {
  ReflectionResultSchema,
  ReflectionIssueSchema,
} from "./domain/reflection.schemas";
export type { ReflectionResult, ReflectionIssue } from "./domain/reflection.schemas";
export {
  FallbackStrategySchema,
  ModelResolutionSchema,
} from "./domain/fallback.schemas";
export type { FallbackStrategy, ModelResolution } from "./domain/fallback.schemas";
// Domain -- Overseer Journal Entry
// Domain -- Journal Extension
export type {
  ArtifactWrittenEntry,
  CheckpointSavedEntry,
  ExecutionLifecycleEntry,
  FileWrittenEntry,
  GuardrailViolationEntry,
  JournalEntry,
  ModelDownshiftEntry,
  OverseerInterventionEntry,
  PhaseChangedEntry,
  PreDispatchBlockedEntry,
  ReflectionEntry,
  TaskCompletedEntry,
  TaskEscalatedEntry,
  TaskFailedEntry,
  TaskStartedEntry,
  ToolExecutionEntry,
  TurnBoundaryEntry,
} from "./domain/journal-entry.schemas";
export {
  ArtifactWrittenEntrySchema,
  CheckpointSavedEntrySchema,
  ExecutionLifecycleEntrySchema,
  FileWrittenEntrySchema,
  GuardrailViolationEntrySchema,
  JournalEntrySchema,
  ModelDownshiftEntrySchema,
  OverseerInterventionEntrySchema,
  PhaseChangedEntrySchema,
  PreDispatchBlockedEntrySchema,
  ReflectionEntrySchema,
  TaskCompletedEntrySchema,
  TaskEscalatedEntrySchema,
  TaskFailedEntrySchema,
  TaskStartedEntrySchema,
  ToolExecutionEntrySchema,
  TurnBoundaryEntrySchema,
} from "./domain/journal-entry.schemas";
// Domain -- Overseer Schemas
export type {
  InterventionAction,
  OverseerConfig,
  OverseerContext,
  OverseerVerdict,
  RetryDecision,
} from "./domain/overseer.schemas";
export {
  InterventionActionSchema,
  OverseerConfigSchema,
  OverseerContextSchema,
  OverseerVerdictSchema,
  RetryDecisionSchema,
} from "./domain/overseer.schemas";
// Domain -- Overseer Strategy
export type { OverseerStrategy } from "./domain/overseer-strategy";
export { CheckpointRepositoryPort } from "./domain/ports/checkpoint-repository.port";
// Domain -- ExecutionSession Ports
export { ExecutionSessionRepositoryPort } from "./domain/ports/execution-session-repository.port";
export { JournalRepositoryPort } from "./domain/ports/journal-repository.port";
export { MetricsQueryPort } from "./domain/ports/metrics-query.port";
export { MetricsRepositoryPort } from "./domain/ports/metrics-repository.port";
export { OutputGuardrailPort } from "./domain/ports/output-guardrail.port";
// Domain -- Overseer Ports
export { OverseerPort } from "./domain/ports/overseer.port";
export { PauseSignalPort } from "./domain/ports/pause-signal.port";
export { PhaseTransitionPort } from "./domain/ports/phase-transition.port";
export { RetryPolicy } from "./domain/ports/retry-policy.port";
export type { SliceStatusProvider } from "./domain/ports/slice-status-provider.port";
export { WorktreePort } from "@kernel/ports/worktree.port";
// Domain -- Builders
export { TaskMetricsBuilder } from "./domain/task-metrics.builder";
export type {
  AggregatedMetrics,
  ModelBreakdownEntry,
  TaskMetrics,
  TaskMetricsModel,
} from "./domain/task-metrics.schemas";
export {
  AggregatedMetricsSchema,
  ModelBreakdownEntrySchema,
  TaskMetricsModelSchema,
  TaskMetricsSchema,
} from "./domain/task-metrics.schemas";
// Domain -- Worktree Schemas
export type { CleanupReport, WorktreeHealth, WorktreeInfo } from "@kernel/ports/worktree.schemas";
export {
  CleanupReportSchema,
  WorktreeHealthSchema,
  WorktreeInfoSchema,
} from "@kernel/ports/worktree.schemas";
// Infrastructure -- Pre-dispatch Adapters
export { ComposablePreDispatchAdapter } from "./infrastructure/adapters/pre-dispatch/composable-pre-dispatch.adapter";
export { InMemoryPreDispatchAdapter } from "./infrastructure/adapters/pre-dispatch/in-memory-pre-dispatch.adapter";
// Infrastructure -- Pre-dispatch Rules
export { ScopeContainmentRule } from "./infrastructure/adapters/pre-dispatch/rules/scope-containment.rule";
export { DependencyCheckRule } from "./infrastructure/adapters/pre-dispatch/rules/dependency-check.rule";
export { WorktreeStateRule } from "./infrastructure/adapters/pre-dispatch/rules/worktree-state.rule";
export type { WorktreeStateGitOps } from "./infrastructure/adapters/pre-dispatch/rules/worktree-state.rule";
export { BudgetCheckRule } from "./infrastructure/adapters/pre-dispatch/rules/budget-check.rule";
export { ToolPolicyRule } from "./infrastructure/adapters/pre-dispatch/rules/tool-policy.rule";
// Infrastructure -- Guardrail Adapters
export { ComposableGuardrailAdapter } from "./infrastructure/adapters/guardrails/composable-guardrail.adapter";
// Infrastructure -- Overseer Adapters
export { ComposableOverseerAdapter } from "./infrastructure/adapters/overseer/composable-overseer.adapter";
export { DefaultRetryPolicy } from "./infrastructure/policies/default-retry-policy";
// Infrastructure -- Adapters (exported for downstream test wiring)
export { GitWorktreeAdapter } from "@kernel/infrastructure/worktree/git-worktree.adapter";
export { InMemoryAgentDispatchAdapter } from "./infrastructure/adapters/agent-dispatch/in-memory-agent-dispatch.adapter";
export { InMemoryCheckpointRepository } from "./infrastructure/repositories/checkpoint/in-memory-checkpoint.repository";
// Infrastructure -- ExecutionSession Adapters
export { InMemoryExecutionSessionAdapter } from "./infrastructure/adapters/execution-session/in-memory-execution-session.adapter";
export { InMemoryGuardrailAdapter } from "./infrastructure/adapters/guardrails/in-memory-guardrail.adapter";
export { InMemoryJournalRepository } from "./infrastructure/repositories/journal/in-memory-journal.repository";
export { InMemoryMetricsRepository } from "./infrastructure/repositories/metrics/in-memory-metrics.repository";
export { InMemoryOverseerAdapter } from "./infrastructure/adapters/overseer/in-memory-overseer.adapter";
export { InMemoryPauseSignalAdapter } from "./infrastructure/adapters/pause-signal/in-memory-pause-signal.adapter";
export { InMemoryWorktreeAdapter } from "@kernel/infrastructure/worktree/in-memory-worktree.adapter";
export { JsonlMetricsRepository } from "./infrastructure/repositories/metrics/jsonl-metrics.repository";
export { MarkdownExecutionSessionAdapter } from "./infrastructure/adapters/execution-session/markdown-execution-session.adapter";
export { PiAgentDispatchAdapter } from "./infrastructure/adapters/agent-dispatch/pi-agent-dispatch.adapter";
export { ProcessSignalPauseAdapter } from "./infrastructure/adapters/pause-signal/process-signal-pause.adapter";
export { TimeoutStrategy } from "./infrastructure/policies/timeout-strategy";

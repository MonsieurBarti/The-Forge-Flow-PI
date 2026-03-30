// Application -- Use Cases
export { AggregateMetricsUseCase } from "./application/aggregate-metrics.use-case";
export { CleanupOrphanedWorktreesUseCase } from "./application/cleanup-orphaned-worktrees.use-case";
export { JournalEventHandler } from "./application/journal-event-handler";
export { RecordTaskMetricsUseCase } from "./application/record-task-metrics.use-case";
export { ReplayJournalUseCase, type ReplayResult } from "./application/replay-journal.use-case";
export {
  type RollbackInput,
  type RollbackResult,
  RollbackSliceUseCase,
} from "./application/rollback-slice.use-case";
// Domain -- Schemas
export type { CheckpointDTO, CheckpointProps, ExecutorLogEntry } from "./domain/checkpoint.schemas";
export { CheckpointPropsSchema, ExecutorLogEntrySchema } from "./domain/checkpoint.schemas";
// Domain -- Errors
export { AgentDispatchError } from "./domain/errors/agent-dispatch.error";
export { CheckpointNotFoundError } from "./domain/errors/checkpoint-not-found.error";
export { InvalidCheckpointStateError } from "./domain/errors/invalid-checkpoint-state.error";
export { JournalReadError } from "./domain/errors/journal-read.error";
export { JournalReplayError } from "./domain/errors/journal-replay.error";
export { JournalWriteError } from "./domain/errors/journal-write.error";
export { RollbackError } from "./domain/errors/rollback.error";
export { WorktreeError } from "./domain/errors/worktree.error";
// Domain -- Events
export { CheckpointSavedEvent } from "./domain/events/checkpoint-saved.event";
export { TaskExecutionCompletedEvent } from "./domain/events/task-execution-completed.event";
export type {
  ArtifactWrittenEntry,
  CheckpointSavedEntry,
  FileWrittenEntry,
  JournalEntry,
  PhaseChangedEntry,
  TaskCompletedEntry,
  TaskFailedEntry,
  TaskStartedEntry,
} from "./domain/journal-entry.schemas";
export {
  ArtifactWrittenEntrySchema,
  CheckpointSavedEntrySchema,
  FileWrittenEntrySchema,
  JournalEntrySchema,
  PhaseChangedEntrySchema,
  TaskCompletedEntrySchema,
  TaskFailedEntrySchema,
  TaskStartedEntrySchema,
} from "./domain/journal-entry.schemas";
// Domain -- Ports
export { AgentDispatchPort } from "./domain/ports/agent-dispatch.port";
export { CheckpointRepositoryPort } from "./domain/ports/checkpoint-repository.port";
export { JournalRepositoryPort } from "./domain/ports/journal-repository.port";
export { MetricsQueryPort } from "./domain/ports/metrics-query.port";
export { MetricsRepositoryPort } from "./domain/ports/metrics-repository.port";
export { PhaseTransitionPort } from "./domain/ports/phase-transition.port";
export type { SliceStatusProvider } from "./domain/ports/slice-status-provider.port";
export { WorktreePort } from "./domain/ports/worktree.port";
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
export type { CleanupReport, WorktreeHealth, WorktreeInfo } from "./domain/worktree.schemas";
export {
  CleanupReportSchema,
  WorktreeHealthSchema,
  WorktreeInfoSchema,
} from "./domain/worktree.schemas";
// Infrastructure -- Adapters (exported for downstream test wiring)
export { GitWorktreeAdapter } from "./infrastructure/git-worktree.adapter";
export { InMemoryAgentDispatchAdapter } from "./infrastructure/in-memory-agent-dispatch.adapter";
export { InMemoryCheckpointRepository } from "./infrastructure/in-memory-checkpoint.repository";
export { InMemoryJournalRepository } from "./infrastructure/in-memory-journal.repository";
export { InMemoryMetricsRepository } from "./infrastructure/in-memory-metrics.repository";
export { InMemoryWorktreeAdapter } from "./infrastructure/in-memory-worktree.adapter";
export { JsonlMetricsRepository } from "./infrastructure/jsonl-metrics.repository";
export { PiAgentDispatchAdapter } from "./infrastructure/pi-agent-dispatch.adapter";

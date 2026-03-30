// Domain -- Schemas

// Application -- Use Cases
export { JournalEventHandler } from "./application/journal-event-handler";
export { ReplayJournalUseCase, type ReplayResult } from "./application/replay-journal.use-case";
export {
  type RollbackInput,
  type RollbackResult,
  RollbackSliceUseCase,
} from "./application/rollback-slice.use-case";
export type { CheckpointDTO, CheckpointProps, ExecutorLogEntry } from "./domain/checkpoint.schemas";
export { CheckpointPropsSchema, ExecutorLogEntrySchema } from "./domain/checkpoint.schemas";
// Domain -- Errors
export { CheckpointNotFoundError } from "./domain/errors/checkpoint-not-found.error";
export { InvalidCheckpointStateError } from "./domain/errors/invalid-checkpoint-state.error";
export { JournalReadError } from "./domain/errors/journal-read.error";
export { JournalReplayError } from "./domain/errors/journal-replay.error";
export { JournalWriteError } from "./domain/errors/journal-write.error";
export { RollbackError } from "./domain/errors/rollback.error";
// Domain -- Events
export { CheckpointSavedEvent } from "./domain/events/checkpoint-saved.event";
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
export { CheckpointRepositoryPort } from "./domain/ports/checkpoint-repository.port";
export { JournalRepositoryPort } from "./domain/ports/journal-repository.port";
export { PhaseTransitionPort } from "./domain/ports/phase-transition.port";

// Infrastructure -- Adapters (exported for downstream test wiring)
export { InMemoryCheckpointRepository } from "./infrastructure/in-memory-checkpoint.repository";
export { InMemoryJournalRepository } from "./infrastructure/in-memory-journal.repository";

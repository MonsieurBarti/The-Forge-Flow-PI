// Domain -- Errors

// Domain -- Schemas
export type { CheckpointDTO, CheckpointProps, ExecutorLogEntry } from "./domain/checkpoint.schemas";
export { CheckpointPropsSchema, ExecutorLogEntrySchema } from "./domain/checkpoint.schemas";
export { CheckpointNotFoundError } from "./domain/errors/checkpoint-not-found.error";
export { InvalidCheckpointStateError } from "./domain/errors/invalid-checkpoint-state.error";
// Domain -- Events
export { CheckpointSavedEvent } from "./domain/events/checkpoint-saved.event";
// Domain -- Ports
export { CheckpointRepositoryPort } from "./domain/ports/checkpoint-repository.port";

// Infrastructure -- Adapters (exported for downstream test wiring)
export { InMemoryCheckpointRepository } from "./infrastructure/in-memory-checkpoint.repository";

import type { PersistenceError, Result } from "@kernel";
import type { Checkpoint } from "../checkpoint.aggregate";

export abstract class CheckpointRepositoryPort {
  abstract save(checkpoint: Checkpoint): Promise<Result<void, PersistenceError>>;
  abstract findBySliceId(sliceId: string): Promise<Result<Checkpoint | null, PersistenceError>>;
  abstract delete(sliceId: string): Promise<Result<void, PersistenceError>>;
}

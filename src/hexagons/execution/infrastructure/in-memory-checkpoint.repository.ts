import { ok, type PersistenceError, type Result } from "@kernel";
import { Checkpoint } from "../domain/checkpoint.aggregate";
import type { CheckpointProps } from "../domain/checkpoint.schemas";
import { CheckpointRepositoryPort } from "../domain/ports/checkpoint-repository.port";

export class InMemoryCheckpointRepository extends CheckpointRepositoryPort {
  private store = new Map<string, CheckpointProps>();

  async save(checkpoint: Checkpoint): Promise<Result<void, PersistenceError>> {
    this.store.set(checkpoint.sliceId, checkpoint.toJSON());
    return ok(undefined);
  }

  async findBySliceId(sliceId: string): Promise<Result<Checkpoint | null, PersistenceError>> {
    const props = this.store.get(sliceId);
    if (!props) return ok(null);
    return ok(Checkpoint.reconstitute(props));
  }

  async delete(sliceId: string): Promise<Result<void, PersistenceError>> {
    this.store.delete(sliceId);
    return ok(undefined);
  }

  seed(checkpoint: Checkpoint): void {
    this.store.set(checkpoint.sliceId, checkpoint.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

import { ok, type PersistenceError, type Result } from "@kernel";
import type { CheckpointRepositoryPort } from "../domain/ports/checkpoint-repository.port";

export class GetSliceExecutorsUseCase {
  constructor(private readonly checkpointRepo: CheckpointRepositoryPort) {}

  async execute(sliceId: string): Promise<Result<ReadonlySet<string>, PersistenceError>> {
    const result = await this.checkpointRepo.findBySliceId(sliceId);
    if (!result.ok) return result;

    const checkpoint = result.data;
    if (!checkpoint) return ok(new Set<string>());

    const identities = new Set(checkpoint.executorLog.map((e) => e.agentIdentity));
    return ok(identities);
  }
}

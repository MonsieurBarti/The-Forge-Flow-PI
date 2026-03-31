import { ok, type Result } from "@kernel";
import type { CheckpointRepositoryPort } from "../domain/ports/checkpoint-repository.port";

export class GetSliceExecutorsUseCase {
  constructor(private readonly checkpointRepo: CheckpointRepositoryPort) {}

  async execute(_sliceId: string): Promise<Result<Set<string>, never>> {
    // TODO: implement — T05
    return ok(new Set<string>());
  }
}

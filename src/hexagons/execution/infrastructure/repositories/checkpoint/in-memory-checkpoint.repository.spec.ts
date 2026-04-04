import { isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { CheckpointBuilder } from "../../../domain/checkpoint.builder";
import { runContractTests } from "./checkpoint-repository.contract.spec";
import { InMemoryCheckpointRepository } from "./in-memory-checkpoint.repository";

runContractTests("InMemoryCheckpointRepository", () => new InMemoryCheckpointRepository());

describe("InMemoryCheckpointRepository -- adapter-specific", () => {
  let repo: InMemoryCheckpointRepository;

  beforeEach(() => {
    repo = new InMemoryCheckpointRepository();
  });

  it("seed() pre-populates store", async () => {
    const cp = new CheckpointBuilder().build();
    repo.seed(cp);

    const result = await repo.findBySliceId(cp.sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data?.id).toBe(cp.id);
    }
  });

  it("reset() clears store", async () => {
    const cp = new CheckpointBuilder().build();
    repo.seed(cp);
    repo.reset();

    const result = await repo.findBySliceId(cp.sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toBeNull();
    }
  });
});

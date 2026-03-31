import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { Checkpoint } from "../domain/checkpoint.aggregate";
import { InMemoryCheckpointRepository } from "../infrastructure/in-memory-checkpoint.repository";
import { GetSliceExecutorsUseCase } from "./get-slice-executors.use-case";

describe("GetSliceExecutorsUseCase", () => {
  const sliceId = "slice-1";
  const now = new Date();

  function setup() {
    const repo = new InMemoryCheckpointRepository();
    const useCase = new GetSliceExecutorsUseCase(repo);
    return { repo, useCase };
  }

  it("returns unique agent identities from executor log (AC2)", async () => {
    const { repo, useCase } = setup();
    const checkpoint = Checkpoint.createNew({ id: "cp-1", sliceId, baseCommit: "abc", now });
    checkpoint.recordTaskStart("t1", "agent-alpha", now);
    checkpoint.recordTaskStart("t2", "agent-beta", now);
    checkpoint.recordTaskStart("t3", "agent-alpha", now); // duplicate
    repo.seed(checkpoint);

    const result = await useCase.execute(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toEqual(new Set(["agent-alpha", "agent-beta"]));
    }
  });

  it("returns empty set when no checkpoint exists (AC3)", async () => {
    const { useCase } = setup();
    const result = await useCase.execute("nonexistent");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.size).toBe(0);
    }
  });

  it("returns empty set when executor log is empty", async () => {
    const { repo, useCase } = setup();
    const checkpoint = Checkpoint.createNew({ id: "cp-2", sliceId, baseCommit: "abc", now });
    repo.seed(checkpoint);

    const result = await useCase.execute(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.size).toBe(0);
    }
  });
});

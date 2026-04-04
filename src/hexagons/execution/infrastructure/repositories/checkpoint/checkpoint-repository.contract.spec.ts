import { isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { CheckpointBuilder } from "../../../domain/checkpoint.builder";
import type { CheckpointRepositoryPort } from "../../../domain/ports/checkpoint-repository.port";

export function runContractTests(
  name: string,
  factory: () => CheckpointRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: CheckpointRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findBySliceId roundtrip", async () => {
      const cp = new CheckpointBuilder().build();
      const saveResult = await repo.save(cp);
      expect(isOk(saveResult)).toBe(true);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        const found = findResult.data;
        expect(found).not.toBeNull();
        if (found) {
          expect(found.id).toBe(cp.id);
          expect(found.sliceId).toBe(cp.sliceId);
          expect(found.baseCommit).toBe(cp.baseCommit);
          expect(found.currentWaveIndex).toBe(cp.currentWaveIndex);
          expect([...found.completedWaves]).toEqual([...cp.completedWaves]);
          expect([...found.completedTasks]).toEqual([...cp.completedTasks]);
        }
      }
    });

    it("save with non-empty executorLog -- roundtrip preserves entries", async () => {
      const cp = new CheckpointBuilder().build();
      const taskId = crypto.randomUUID();
      cp.recordTaskStart(taskId, "opus", new Date());
      await repo.save(cp);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data?.executorLog).toHaveLength(1);
        expect(findResult.data?.executorLog[0].taskId).toBe(taskId);
        expect(findResult.data?.executorLog[0].agentIdentity).toBe("opus");
      }
    });

    it("findBySliceId returns null for missing slice", async () => {
      const result = await repo.findBySliceId(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("save overwrites existing checkpoint for same slice", async () => {
      const cp = new CheckpointBuilder().build();
      await repo.save(cp);

      cp.advanceWave(new Date());
      await repo.save(cp);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        const found = findResult.data;
        if (found) {
          expect(found.currentWaveIndex).toBe(1);
          expect([...found.completedWaves]).toEqual([0]);
        }
      }
    });

    it("save after recordTaskComplete persists completedTasks (AC6)", async () => {
      const cp = new CheckpointBuilder().build();
      const taskId = crypto.randomUUID();
      cp.recordTaskStart(taskId, "opus", new Date());
      cp.recordTaskComplete(taskId, new Date());
      await repo.save(cp);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        const found = findResult.data;
        if (found) {
          expect([...found.completedTasks]).toContain(taskId);
        }
      }
    });

    it("save after advanceWave persists completedWaves (AC7)", async () => {
      const cp = new CheckpointBuilder().build();
      cp.advanceWave(new Date());
      cp.advanceWave(new Date());
      await repo.save(cp);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        const found = findResult.data;
        if (found) {
          expect([...found.completedWaves]).toEqual([0, 1]);
          expect(found.currentWaveIndex).toBe(2);
        }
      }
    });

    it("delete removes checkpoint", async () => {
      const cp = new CheckpointBuilder().build();
      await repo.save(cp);
      const deleteResult = await repo.delete(cp.sliceId);
      expect(isOk(deleteResult)).toBe(true);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).toBeNull();
      }
    });

    it("delete is no-op for missing checkpoint", async () => {
      const result = await repo.delete(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
    });
  });
}

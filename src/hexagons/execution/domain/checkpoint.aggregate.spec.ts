import { EVENT_NAMES, isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { Checkpoint } from "./checkpoint.aggregate";

describe("Checkpoint", () => {
  const id = crypto.randomUUID();
  const sliceId = crypto.randomUUID();
  const now = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-06-01T00:00:00Z");
  const taskId1 = crypto.randomUUID();
  const taskId2 = crypto.randomUUID();

  describe("createNew", () => {
    it("creates checkpoint with wave 0, empty completedTasks/completedWaves (AC1)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });

      expect(cp.id).toBe(id);
      expect(cp.sliceId).toBe(sliceId);
      expect(cp.baseCommit).toBe("abc123f");
      expect(cp.currentWaveIndex).toBe(0);
      expect(cp.completedWaves).toEqual([]);
      expect(cp.completedTasks).toEqual([]);
      expect(cp.executorLog).toEqual([]);
      expect(cp.createdAt).toEqual(now);
      expect(cp.updatedAt).toEqual(now);
    });

    it("does not emit domain events (no CheckpointCreatedEvent)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      expect(cp.pullEvents()).toEqual([]);
    });

    it("throws on empty baseCommit", () => {
      expect(() => Checkpoint.createNew({ id, sliceId, baseCommit: "", now })).toThrow();
    });

    it("throws on invalid id", () => {
      expect(() =>
        Checkpoint.createNew({ id: "bad", sliceId, baseCommit: "abc123f", now }),
      ).toThrow();
    });
  });

  describe("reconstitute", () => {
    it("hydrates from props without events", () => {
      const cp = Checkpoint.reconstitute({
        version: 1,
        id,
        sliceId,
        baseCommit: "abc123f",
        currentWaveIndex: 2,
        completedWaves: [0, 1],
        completedTasks: [taskId1],
        executorLog: [
          { taskId: taskId1, agentIdentity: "opus", startedAt: now, completedAt: later },
        ],
        createdAt: now,
        updatedAt: later,
      });

      expect(cp.id).toBe(id);
      expect(cp.currentWaveIndex).toBe(2);
      expect(cp.completedWaves).toEqual([0, 1]);
      expect(cp.completedTasks).toEqual([taskId1]);
      expect(cp.executorLog).toHaveLength(1);
      expect(cp.pullEvents()).toEqual([]);
    });
  });

  describe("recordTaskStart", () => {
    it("adds entry to executorLog", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      const result = cp.recordTaskStart(taskId1, "opus", later);

      expect(isOk(result)).toBe(true);
      expect(cp.executorLog).toHaveLength(1);
      expect(cp.executorLog[0].taskId).toBe(taskId1);
      expect(cp.executorLog[0].agentIdentity).toBe("opus");
      expect(cp.executorLog[0].startedAt).toEqual(later);
      expect(cp.executorLog[0].completedAt).toBeNull();
    });

    it("is idempotent -- second call for same taskId is no-op (AC2)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", later);
      cp.recordTaskStart(taskId1, "opus", later);

      expect(cp.executorLog).toHaveLength(1);
    });

    it("overwrites agentIdentity when called with different identity (AC2)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", later);
      cp.recordTaskStart(taskId1, "sonnet", later);

      expect(cp.executorLog).toHaveLength(1);
      expect(cp.executorLog[0].agentIdentity).toBe("sonnet");
    });

    it("updates updatedAt (AC14)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", later);

      expect(cp.updatedAt).toEqual(later);
    });

    it("does not emit events", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", later);

      expect(cp.pullEvents()).toEqual([]);
    });
  });

  describe("recordTaskComplete", () => {
    it("marks task as completed and adds to completedTasks", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);
      const result = cp.recordTaskComplete(taskId1, later);

      expect(isOk(result)).toBe(true);
      expect(cp.completedTasks).toContain(taskId1);
      expect(cp.executorLog[0].completedAt).toEqual(later);
    });

    it("fails with InvalidCheckpointStateError if task not started (AC3)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      const result = cp.recordTaskComplete(taskId1, later);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("CHECKPOINT.INVALID_STATE");
      }
    });

    it("fails if task already completed", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);
      cp.recordTaskComplete(taskId1, later);
      const result = cp.recordTaskComplete(taskId1, later);

      expect(isErr(result)).toBe(true);
    });

    it("emits CheckpointSavedEvent (AC11)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);
      cp.recordTaskComplete(taskId1, later);

      const events = cp.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.CHECKPOINT_SAVED);
    });

    it("updates updatedAt (AC14)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);
      cp.recordTaskComplete(taskId1, later);

      expect(cp.updatedAt).toEqual(later);
    });
  });

  describe("advanceWave", () => {
    it("increments currentWaveIndex and appends previous to completedWaves (AC4)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      const result = cp.advanceWave(later);

      expect(isOk(result)).toBe(true);
      expect(cp.completedWaves).toEqual([0]);
      expect(cp.currentWaveIndex).toBe(1);
    });

    it("guards against duplicate advance (AC4)", () => {
      const cp = Checkpoint.reconstitute({
        version: 1,
        id,
        sliceId,
        baseCommit: "abc123f",
        currentWaveIndex: 1,
        completedWaves: [0, 1],
        completedTasks: [],
        executorLog: [],
        createdAt: now,
        updatedAt: now,
      });
      const result = cp.advanceWave(later);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("CHECKPOINT.INVALID_STATE");
      }
    });

    it("emits CheckpointSavedEvent (AC11)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.advanceWave(later);

      const events = cp.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.CHECKPOINT_SAVED);
    });

    it("updates updatedAt (AC14)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.advanceWave(later);

      expect(cp.updatedAt).toEqual(later);
    });
  });

  describe("queries", () => {
    it("isTaskCompleted returns correct state (AC5)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);
      cp.recordTaskComplete(taskId1, later);

      expect(cp.isTaskCompleted(taskId1)).toBe(true);
      expect(cp.isTaskCompleted(taskId2)).toBe(false);
    });

    it("isWaveCompleted returns correct state (AC5)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.advanceWave(later);

      expect(cp.isWaveCompleted(0)).toBe(true);
      expect(cp.isWaveCompleted(1)).toBe(false);
    });

    it("isTaskStarted returns correct state (AC5)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);

      expect(cp.isTaskStarted(taskId1)).toBe(true);
      expect(cp.isTaskStarted(taskId2)).toBe(false);
    });
  });

  describe("toJSON", () => {
    it("returns a copy of props", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      const json = cp.toJSON();

      expect(json).toEqual({
        version: 1,
        id,
        sliceId,
        baseCommit: "abc123f",
        currentWaveIndex: 0,
        completedWaves: [],
        completedTasks: [],
        executorLog: [],
        createdAt: now,
        updatedAt: now,
      });
    });
  });
});

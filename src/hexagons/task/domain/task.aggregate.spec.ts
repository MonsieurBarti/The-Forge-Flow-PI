import { EVENT_NAMES, isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { Task } from "./task.aggregate";

describe("Task", () => {
  const id = crypto.randomUUID();
  const sliceId = crypto.randomUUID();
  const now = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-06-01T00:00:00Z");

  describe("createNew", () => {
    it("creates a valid task with status open", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });

      expect(t.id).toBe(id);
      expect(t.sliceId).toBe(sliceId);
      expect(t.label).toBe("T01");
      expect(t.title).toBe("Schemas");
      expect(t.description).toBe("");
      expect(t.acceptanceCriteria).toBe("");
      expect(t.filePaths).toEqual([]);
      expect(t.status).toBe("open");
      expect(t.blockedBy).toEqual([]);
      expect(t.waveIndex).toBeNull();
      expect(t.createdAt).toEqual(now);
      expect(t.updatedAt).toEqual(now);
    });

    it("accepts optional fields", () => {
      const t = Task.createNew({
        id,
        sliceId,
        label: "T01",
        title: "Schemas",
        description: "Build schemas",
        acceptanceCriteria: "AC1: schemas exist",
        filePaths: ["src/task.schemas.ts"],
        now,
      });
      expect(t.description).toBe("Build schemas");
      expect(t.acceptanceCriteria).toBe("AC1: schemas exist");
      expect(t.filePaths).toEqual(["src/task.schemas.ts"]);
    });

    it("emits TaskCreatedEvent", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      const events = t.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.TASK_CREATED);
      expect(events[0].aggregateId).toBe(id);
    });

    it("throws on invalid label format", () => {
      expect(() => Task.createNew({ id, sliceId, label: "bad", title: "Schemas", now })).toThrow();
    });

    it("throws on empty title", () => {
      expect(() => Task.createNew({ id, sliceId, label: "T01", title: "", now })).toThrow();
    });

    it("throws on invalid id", () => {
      expect(() =>
        Task.createNew({ id: "not-a-uuid", sliceId, label: "T01", title: "Schemas", now }),
      ).toThrow();
    });

    it("should accept optional blockedBy in createNew", () => {
      const blockerId = crypto.randomUUID();
      const task = Task.createNew({
        id: crypto.randomUUID(),
        sliceId: crypto.randomUUID(),
        label: "T02",
        title: "Depends on T01",
        blockedBy: [blockerId],
        now: new Date(),
      });
      expect(task.blockedBy).toEqual([blockerId]);
    });

    it("defaults blockedBy to [] when not provided", () => {
      const task = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      expect(task.blockedBy).toEqual([]);
    });
  });

  describe("start", () => {
    it("transitions open -> in_progress", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      const result = t.start(later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("in_progress");
      expect(t.updatedAt).toEqual(later);
    });

    it("rejects from closed", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.start(now);
      t.complete(now);
      const result = t.start(later);

      expect(isErr(result)).toBe(true);
    });
  });

  describe("complete", () => {
    it("transitions in_progress -> closed, emits TaskCompletedEvent", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.start(now);
      t.pullEvents();
      const result = t.complete(later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("closed");
      expect(t.updatedAt).toEqual(later);

      const events = t.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.TASK_COMPLETED);
    });

    it("rejects from open", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      const result = t.complete(later);

      expect(isErr(result)).toBe(true);
    });
  });

  describe("block", () => {
    it("transitions open -> blocked, sets blockedBy, emits TaskBlockedEvent", () => {
      const blockerId = crypto.randomUUID();
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.pullEvents();
      const result = t.block([blockerId], later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("blocked");
      expect(t.blockedBy).toEqual([blockerId]);
      expect(t.updatedAt).toEqual(later);

      const events = t.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.TASK_BLOCKED);
    });

    it("on already-blocked task adds to blockedBy (self-transition), no duplicate event", () => {
      const blocker1 = crypto.randomUUID();
      const blocker2 = crypto.randomUUID();
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.block([blocker1], now);
      t.pullEvents();

      const result = t.block([blocker2], later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("blocked");
      expect(t.blockedBy).toContain(blocker1);
      expect(t.blockedBy).toContain(blocker2);
      expect(t.pullEvents()).toEqual([]);
    });

    it("allows from in_progress (execution failure path)", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.start(now);
      const blockerId = crypto.randomUUID();
      const result = t.block([blockerId], later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("blocked");
      expect(t.blockedBy).toContain(blockerId);
    });
  });

  describe("unblock", () => {
    it("removes blocker; if blockedBy empty, transitions blocked -> open", () => {
      const blockerId = crypto.randomUUID();
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.block([blockerId], now);
      const result = t.unblock(blockerId, later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("open");
      expect(t.blockedBy).toEqual([]);
      expect(t.updatedAt).toEqual(later);
    });

    it("with remaining blockers stays blocked (self-transition)", () => {
      const blocker1 = crypto.randomUUID();
      const blocker2 = crypto.randomUUID();
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.block([blocker1, blocker2], now);
      const result = t.unblock(blocker1, later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("blocked");
      expect(t.blockedBy).toEqual([blocker2]);
    });

    it("rejects from non-blocked status", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      const result = t.unblock(crypto.randomUUID(), later);

      expect(isErr(result)).toBe(true);
    });
  });

  describe("assignToWave", () => {
    it("sets waveIndex and updates updatedAt", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.assignToWave(2, later);

      expect(t.waveIndex).toBe(2);
      expect(t.updatedAt).toEqual(later);
    });
  });

  describe("reconstitute", () => {
    it("hydrates from props without emitting events", () => {
      const props = {
        id,
        sliceId,
        label: "T01",
        title: "Schemas",
        description: "",
        acceptanceCriteria: "",
        filePaths: [] as string[],
        status: "open" as const,
        blockedBy: [] as string[],
        waveIndex: null,
        createdAt: now,
        updatedAt: now,
      };
      const t = Task.reconstitute(props);

      expect(t.id).toBe(id);
      expect(t.label).toBe("T01");
      expect(t.pullEvents()).toEqual([]);
    });

    it("throws on invalid props", () => {
      expect(() =>
        Task.reconstitute({
          id: "not-a-uuid",
          sliceId,
          label: "T01",
          title: "Schemas",
          description: "",
          acceptanceCriteria: "",
          filePaths: [],
          status: "open" as const,
          blockedBy: [],
          waveIndex: null,
          createdAt: now,
          updatedAt: now,
        }),
      ).toThrow();
    });
  });

  describe("toJSON", () => {
    it("returns a copy of props", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      const json = t.toJSON();

      expect(json).toEqual({
        id,
        sliceId,
        label: "T01",
        title: "Schemas",
        description: "",
        acceptanceCriteria: "",
        filePaths: [],
        status: "open",
        blockedBy: [],
        waveIndex: null,
        createdAt: now,
        updatedAt: now,
      });
    });
  });
});

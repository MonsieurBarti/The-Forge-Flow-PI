import { SliceStatusChangedEvent } from "@hexagons/slice/domain/events/slice-status-changed.event";
import { TaskBlockedEvent } from "@hexagons/task/domain/events/task-blocked.event";
import { TaskCompletedEvent } from "@hexagons/task/domain/events/task-completed.event";
import { InProcessEventBus, isOk, SilentLoggerAdapter } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { CheckpointSavedEvent } from "../domain/events/checkpoint-saved.event";
import { InMemoryJournalRepository } from "../infrastructure/repositories/journal/in-memory-journal.repository";
import { JournalEventHandler } from "./journal-event-handler";

describe("JournalEventHandler", () => {
  let repo: InMemoryJournalRepository;
  let bus: InProcessEventBus;
  let handler: JournalEventHandler;

  beforeEach(() => {
    repo = new InMemoryJournalRepository();
    bus = new InProcessEventBus(new SilentLoggerAdapter());
    handler = new JournalEventHandler(repo);
    handler.register(bus);
  });

  it("appends checkpoint-saved entry on CheckpointSavedEvent", async () => {
    const sliceId = crypto.randomUUID();
    await bus.publish(
      new CheckpointSavedEvent({
        id: crypto.randomUUID(),
        aggregateId: crypto.randomUUID(),
        occurredAt: new Date(),
        sliceId,
        waveIndex: 2,
        completedTaskCount: 5,
      }),
    );

    const result = await repo.readAll(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe("checkpoint-saved");
      if (result.data[0].type === "checkpoint-saved") {
        expect(result.data[0].waveIndex).toBe(2);
        expect(result.data[0].completedTaskCount).toBe(5);
      }
    }
  });

  it("appends task-completed entry on TaskCompletedEvent", async () => {
    const sliceId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await bus.publish(
      new TaskCompletedEvent({
        id: crypto.randomUUID(),
        aggregateId: taskId,
        occurredAt: new Date(),
        sliceId,
        taskId,
        waveIndex: 1,
        durationMs: 3000,
        commitHash: "abc123",
      }),
    );

    const result = await repo.readAll(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe("task-completed");
      if (result.data[0].type === "task-completed") {
        expect(result.data[0].taskId).toBe(taskId);
        expect(result.data[0].durationMs).toBe(3000);
        expect(result.data[0].commitHash).toBe("abc123");
      }
    }
  });

  it("appends task-failed entry with retryable=true on TaskBlockedEvent", async () => {
    const sliceId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await bus.publish(
      new TaskBlockedEvent({
        id: crypto.randomUUID(),
        aggregateId: taskId,
        occurredAt: new Date(),
        sliceId,
        taskId,
        waveIndex: 0,
        errorCode: "AGENT.TIMEOUT",
        errorMessage: "Agent timed out",
      }),
    );

    const result = await repo.readAll(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe("task-failed");
      if (result.data[0].type === "task-failed") {
        expect(result.data[0].retryable).toBe(true);
        expect(result.data[0].errorCode).toBe("AGENT.TIMEOUT");
      }
    }
  });

  it("appends phase-changed entry on SliceStatusChangedEvent", async () => {
    const sliceId = crypto.randomUUID();
    await bus.publish(
      new SliceStatusChangedEvent({
        id: crypto.randomUUID(),
        aggregateId: sliceId, // sliceId IS the aggregateId for slices
        occurredAt: new Date(),
        from: "planning",
        to: "executing",
      }),
    );

    const result = await repo.readAll(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe("phase-changed");
      if (result.data[0].type === "phase-changed") {
        expect(result.data[0].from).toBe("planning");
        expect(result.data[0].to).toBe("executing");
      }
    }
  });

  it("uses correct sliceId from event payload", async () => {
    const sliceId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID(); // different from sliceId
    await bus.publish(
      new TaskCompletedEvent({
        id: crypto.randomUUID(),
        aggregateId,
        occurredAt: new Date(),
        sliceId,
        taskId: aggregateId,
        waveIndex: 0,
        durationMs: 100,
      }),
    );

    const result = await repo.readAll(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].sliceId).toBe(sliceId);
    }
  });
});

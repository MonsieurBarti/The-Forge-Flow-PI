import { randomUUID } from "node:crypto";
import { EVENT_NAMES } from "@kernel";
import { describe, expect, it } from "vitest";
import { AllTasksCompletedEvent } from "./all-tasks-completed.event";

describe("AllTasksCompletedEvent", () => {
  it("has correct eventName", () => {
    const event = new AllTasksCompletedEvent({
      id: randomUUID(),
      aggregateId: randomUUID(),
      occurredAt: new Date(),
      sliceId: randomUUID(),
      milestoneId: randomUUID(),
      completedTaskCount: 5,
      totalWaveCount: 2,
    });
    expect(event.eventName).toBe(EVENT_NAMES.ALL_TASKS_COMPLETED);
  });

  it("exposes typed properties", () => {
    const sliceId = randomUUID();
    const milestoneId = randomUUID();
    const event = new AllTasksCompletedEvent({
      id: randomUUID(),
      aggregateId: sliceId,
      occurredAt: new Date(),
      sliceId,
      milestoneId,
      completedTaskCount: 3,
      totalWaveCount: 1,
    });
    expect(event.sliceId).toBe(sliceId);
    expect(event.milestoneId).toBe(milestoneId);
    expect(event.completedTaskCount).toBe(3);
    expect(event.totalWaveCount).toBe(1);
  });

  it("validates props via schema — rejects negative completedTaskCount", () => {
    expect(
      () =>
        new AllTasksCompletedEvent({
          id: randomUUID(),
          aggregateId: randomUUID(),
          occurredAt: new Date(),
          sliceId: randomUUID(),
          milestoneId: randomUUID(),
          completedTaskCount: -1,
          totalWaveCount: 2,
        }),
    ).toThrow();
  });

  it("validates props via schema — rejects zero totalWaveCount", () => {
    expect(
      () =>
        new AllTasksCompletedEvent({
          id: randomUUID(),
          aggregateId: randomUUID(),
          occurredAt: new Date(),
          sliceId: randomUUID(),
          milestoneId: randomUUID(),
          completedTaskCount: 0,
          totalWaveCount: 0,
        }),
    ).toThrow();
  });
});

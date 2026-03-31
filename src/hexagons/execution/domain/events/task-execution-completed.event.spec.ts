import { AgentResultBuilder } from "@kernel/agents";
import { describe, expect, it } from "vitest";
import { TaskExecutionCompletedEvent } from "./task-execution-completed.event";

describe("TaskExecutionCompletedEvent", () => {
  const agentResult = new AgentResultBuilder().build();

  function validProps() {
    return {
      id: crypto.randomUUID(),
      aggregateId: crypto.randomUUID(),
      occurredAt: new Date(),
      taskId: agentResult.taskId,
      sliceId: crypto.randomUUID(),
      milestoneId: crypto.randomUUID(),
      waveIndex: 0,
      modelProfile: "balanced" as const,
      agentResult,
    };
  }

  it("constructs with valid props", () => {
    const event = new TaskExecutionCompletedEvent(validProps());
    expect(event.eventName).toBe("execution.task-execution-completed");
    expect(event.taskId).toBe(agentResult.taskId);
    expect(event.agentResult.cost.costUsd).toBe(agentResult.cost.costUsd);
  });

  it("exposes all fields from props", () => {
    const props = validProps();
    const event = new TaskExecutionCompletedEvent(props);
    expect(event.sliceId).toBe(props.sliceId);
    expect(event.milestoneId).toBe(props.milestoneId);
    expect(event.waveIndex).toBe(0);
    expect(event.modelProfile).toBe("balanced");
  });

  it("carries full AgentResult including cost", () => {
    const event = new TaskExecutionCompletedEvent(validProps());
    expect(event.agentResult.cost.inputTokens).toBe(agentResult.cost.inputTokens);
    expect(event.agentResult.cost.outputTokens).toBe(agentResult.cost.outputTokens);
    expect(event.agentResult.cost.costUsd).toBe(agentResult.cost.costUsd);
    expect(event.agentResult.status).toBe(agentResult.status);
  });

  it("rejects invalid waveIndex", () => {
    expect(() => new TaskExecutionCompletedEvent({ ...validProps(), waveIndex: -1 })).toThrow();
  });

  it("rejects invalid modelProfile", () => {
    expect(
      () =>
        new TaskExecutionCompletedEvent({ ...validProps(), modelProfile: "premium" as "balanced" }),
    ).toThrow();
  });
});

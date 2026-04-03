import type { AgentEvent } from "@kernel/agents/agent-event.schema";
import { describe, expect, it } from "vitest";
import { InMemoryAgentEventHub } from "./in-memory-agent-event-hub";

const TASK_A = crypto.randomUUID();
const TASK_B = crypto.randomUUID();

function turnStart(taskId: string, turnIndex = 0): AgentEvent {
  return { type: "turn_start", taskId, turnIndex, timestamp: Date.now() };
}

describe("InMemoryAgentEventHub", () => {
  it("delivers event to subscribed listener", () => {
    const hub = new InMemoryAgentEventHub();
    const received: AgentEvent[] = [];
    hub.subscribe(TASK_A, (e) => received.push(e));

    const event = turnStart(TASK_A);
    hub.emit(TASK_A, event);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(event);
  });

  it("delivers to multiple listeners for same task", () => {
    const hub = new InMemoryAgentEventHub();
    const r1: AgentEvent[] = [];
    const r2: AgentEvent[] = [];
    hub.subscribe(TASK_A, (e) => r1.push(e));
    hub.subscribe(TASK_A, (e) => r2.push(e));

    hub.emit(TASK_A, turnStart(TASK_A));

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it("isolates events per task", () => {
    const hub = new InMemoryAgentEventHub();
    const taskAEvents: AgentEvent[] = [];
    const taskBEvents: AgentEvent[] = [];
    hub.subscribe(TASK_A, (e) => taskAEvents.push(e));
    hub.subscribe(TASK_B, (e) => taskBEvents.push(e));

    hub.emit(TASK_A, turnStart(TASK_A));
    hub.emit(TASK_B, turnStart(TASK_B));

    expect(taskAEvents).toHaveLength(1);
    expect(taskBEvents).toHaveLength(1);
    expect(taskAEvents[0].taskId).toBe(TASK_A);
    expect(taskBEvents[0].taskId).toBe(TASK_B);
  });

  it("unsubscribe stops event delivery", () => {
    const hub = new InMemoryAgentEventHub();
    const received: AgentEvent[] = [];
    const unsub = hub.subscribe(TASK_A, (e) => received.push(e));

    hub.emit(TASK_A, turnStart(TASK_A));
    unsub();
    hub.emit(TASK_A, turnStart(TASK_A));

    expect(received).toHaveLength(1);
  });

  it("clear() removes all listeners for a task", () => {
    const hub = new InMemoryAgentEventHub();
    const received: AgentEvent[] = [];
    hub.subscribe(TASK_A, (e) => received.push(e));
    hub.subscribe(TASK_A, (e) => received.push(e));

    hub.clear(TASK_A);
    hub.emit(TASK_A, turnStart(TASK_A));

    expect(received).toHaveLength(0);
  });

  it("clear() does not affect other tasks", () => {
    const hub = new InMemoryAgentEventHub();
    const taskBEvents: AgentEvent[] = [];
    hub.subscribe(TASK_A, () => {});
    hub.subscribe(TASK_B, (e) => taskBEvents.push(e));

    hub.clear(TASK_A);
    hub.emit(TASK_B, turnStart(TASK_B));

    expect(taskBEvents).toHaveLength(1);
  });

  it("emit with no listeners is a no-op", () => {
    const hub = new InMemoryAgentEventHub();
    expect(() => hub.emit(TASK_A, turnStart(TASK_A))).not.toThrow();
  });

  it("clear on non-existent task is a no-op", () => {
    const hub = new InMemoryAgentEventHub();
    expect(() => hub.clear(TASK_A)).not.toThrow();
  });
});

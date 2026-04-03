import type { AgentEvent } from "@kernel/agents/agent-event.schema";
import { describe, expect, it } from "vitest";
import { TurnMetricsCollector } from "./turn-metrics-collector";

const TASK_ID = crypto.randomUUID();

function event(overrides: Partial<AgentEvent> & { type: AgentEvent["type"] }): AgentEvent {
  return {
    taskId: TASK_ID,
    turnIndex: 0,
    timestamp: Date.now(),
    ...overrides,
  } as AgentEvent;
}

describe("TurnMetricsCollector", () => {
  it("produces empty array when no events recorded", () => {
    const collector = new TurnMetricsCollector();
    expect(collector.toMetrics()).toEqual([]);
  });

  it("produces one turn from turn_start + turn_end", () => {
    const collector = new TurnMetricsCollector();
    collector.record(event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }));
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 0,
        timestamp: 4000,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].turnIndex).toBe(0);
    expect(metrics[0].durationMs).toBe(3000);
    expect(metrics[0].toolCalls).toEqual([]);
  });

  it("accumulates tool calls within a turn", () => {
    const collector = new TurnMetricsCollector();
    collector.record(event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }));
    collector.record(
      event({
        type: "tool_execution_end",
        turnIndex: 0,
        toolCallId: "tc_1",
        toolName: "Read",
        isError: false,
        durationMs: 50,
        timestamp: 1500,
      }),
    );
    collector.record(
      event({
        type: "tool_execution_end",
        turnIndex: 0,
        toolCallId: "tc_2",
        toolName: "Edit",
        isError: false,
        durationMs: 100,
        timestamp: 2000,
      }),
    );
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 2,
        timestamp: 3000,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics[0].toolCalls).toHaveLength(2);
    expect(metrics[0].toolCalls[0].toolName).toBe("Read");
    expect(metrics[0].toolCalls[1].toolName).toBe("Edit");
  });

  it("tracks multiple turns", () => {
    const collector = new TurnMetricsCollector();
    collector.record(event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }));
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 0,
        timestamp: 2000,
      }),
    );
    collector.record(event({ type: "turn_start", turnIndex: 1, timestamp: 2000 }));
    collector.record(
      event({
        type: "tool_execution_end",
        turnIndex: 1,
        toolCallId: "tc_1",
        toolName: "Bash",
        isError: true,
        durationMs: 200,
        timestamp: 2500,
      }),
    );
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 1,
        toolCallCount: 1,
        timestamp: 3000,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics).toHaveLength(2);
    expect(metrics[0].durationMs).toBe(1000);
    expect(metrics[1].durationMs).toBe(1000);
    expect(metrics[1].toolCalls[0].isError).toBe(true);
  });

  it("handles partial turn (no turn_end) with durationMs = 0", () => {
    const collector = new TurnMetricsCollector();
    collector.record(event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }));
    collector.record(
      event({
        type: "tool_execution_end",
        turnIndex: 0,
        toolCallId: "tc_1",
        toolName: "Read",
        isError: false,
        durationMs: 50,
        timestamp: 1500,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].durationMs).toBe(0);
    expect(metrics[0].toolCalls).toHaveLength(1);
  });

  it("toMetrics() is idempotent", () => {
    const collector = new TurnMetricsCollector();
    collector.record(event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }));
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 0,
        timestamp: 2000,
      }),
    );

    const first = collector.toMetrics();
    const second = collector.toMetrics();
    expect(first).toEqual(second);
  });

  it("ignores message events", () => {
    const collector = new TurnMetricsCollector();
    collector.record(event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }));
    collector.record(event({ type: "message_start", turnIndex: 0, timestamp: 1100 }));
    collector.record(
      event({
        type: "message_update",
        turnIndex: 0,
        textDelta: "hi",
        timestamp: 1200,
      }),
    );
    collector.record(event({ type: "message_end", turnIndex: 0, timestamp: 1300 }));
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 0,
        timestamp: 2000,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].toolCalls).toEqual([]);
  });

  it("ignores tool_execution_start and tool_execution_update", () => {
    const collector = new TurnMetricsCollector();
    collector.record(event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }));
    collector.record(
      event({
        type: "tool_execution_start",
        turnIndex: 0,
        toolCallId: "tc_1",
        toolName: "Read",
        timestamp: 1100,
      }),
    );
    collector.record(
      event({
        type: "tool_execution_update",
        turnIndex: 0,
        toolCallId: "tc_1",
        toolName: "Read",
        timestamp: 1200,
      }),
    );
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 0,
        timestamp: 2000,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics[0].toolCalls).toEqual([]);
  });
});

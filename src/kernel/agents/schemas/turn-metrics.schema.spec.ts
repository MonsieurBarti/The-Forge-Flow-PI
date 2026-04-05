import { describe, expect, it } from "vitest";
import { ToolCallMetricsSchema, TurnMetricsSchema } from "./turn-metrics.schema";

describe("ToolCallMetricsSchema", () => {
  it("parses valid tool call metrics", () => {
    const result = ToolCallMetricsSchema.parse({
      toolCallId: "tc_001",
      toolName: "Read",
      durationMs: 150,
      isError: false,
    });
    expect(result.toolName).toBe("Read");
    expect(result.durationMs).toBe(150);
  });

  it("rejects negative durationMs", () => {
    expect(() =>
      ToolCallMetricsSchema.parse({
        toolCallId: "tc_001",
        toolName: "Read",
        durationMs: -1,
        isError: false,
      }),
    ).toThrow();
  });

  it("rejects non-integer durationMs", () => {
    expect(() =>
      ToolCallMetricsSchema.parse({
        toolCallId: "tc_001",
        toolName: "Read",
        durationMs: 1.5,
        isError: false,
      }),
    ).toThrow();
  });

  it("rejects empty toolCallId", () => {
    expect(() =>
      ToolCallMetricsSchema.parse({
        toolCallId: "",
        toolName: "Read",
        durationMs: 100,
        isError: false,
      }),
    ).toThrow();
  });
});

describe("TurnMetricsSchema", () => {
  it("parses valid turn metrics with tool calls", () => {
    const result = TurnMetricsSchema.parse({
      turnIndex: 0,
      toolCalls: [{ toolCallId: "tc_001", toolName: "Read", durationMs: 50, isError: false }],
      durationMs: 3000,
    });
    expect(result.turnIndex).toBe(0);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.durationMs).toBe(3000);
  });

  it("defaults toolCalls to empty array", () => {
    const result = TurnMetricsSchema.parse({ turnIndex: 1, durationMs: 1000 });
    expect(result.toolCalls).toEqual([]);
  });

  it("rejects negative turnIndex", () => {
    expect(() => TurnMetricsSchema.parse({ turnIndex: -1, durationMs: 100 })).toThrow();
  });

  it("rejects non-integer turnIndex", () => {
    expect(() => TurnMetricsSchema.parse({ turnIndex: 0.5, durationMs: 100 })).toThrow();
  });

  it("accepts turnIndex = 0", () => {
    const result = TurnMetricsSchema.parse({ turnIndex: 0, durationMs: 100 });
    expect(result.turnIndex).toBe(0);
  });

  it("accepts durationMs = 0 (partial turn)", () => {
    const result = TurnMetricsSchema.parse({ turnIndex: 0, durationMs: 0 });
    expect(result.durationMs).toBe(0);
  });
});

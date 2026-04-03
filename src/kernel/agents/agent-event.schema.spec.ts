import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  AgentMessageEndSchema,
  AgentMessageStartSchema,
  AgentMessageUpdateSchema,
  AgentToolExecutionEndSchema,
  AgentToolExecutionStartSchema,
  AgentToolExecutionUpdateSchema,
  AgentTurnEndSchema,
  AgentTurnStartSchema,
} from "./agent-event.schema";

const TASK_ID = crypto.randomUUID();
const NOW = Date.now();

const base = { taskId: TASK_ID, turnIndex: 0, timestamp: NOW };

describe("AgentTurnStartSchema", () => {
  it("parses valid turn_start", () => {
    const result = AgentTurnStartSchema.parse({ ...base, type: "turn_start" });
    expect(result.type).toBe("turn_start");
    expect(result.taskId).toBe(TASK_ID);
  });

  it("rejects negative turnIndex", () => {
    expect(() =>
      AgentTurnStartSchema.parse({ ...base, type: "turn_start", turnIndex: -1 }),
    ).toThrow();
  });
});

describe("AgentTurnEndSchema", () => {
  it("parses valid turn_end with toolCallCount", () => {
    const result = AgentTurnEndSchema.parse({ ...base, type: "turn_end", toolCallCount: 3 });
    expect(result.toolCallCount).toBe(3);
  });

  it("rejects missing toolCallCount", () => {
    expect(() => AgentTurnEndSchema.parse({ ...base, type: "turn_end" })).toThrow();
  });
});

describe("AgentMessageStartSchema", () => {
  it("parses valid message_start", () => {
    const result = AgentMessageStartSchema.parse({ ...base, type: "message_start" });
    expect(result.type).toBe("message_start");
  });
});

describe("AgentMessageUpdateSchema", () => {
  it("parses valid message_update with textDelta", () => {
    const result = AgentMessageUpdateSchema.parse({
      ...base,
      type: "message_update",
      textDelta: "Hello",
    });
    expect(result.textDelta).toBe("Hello");
  });

  it("accepts empty string textDelta", () => {
    const result = AgentMessageUpdateSchema.parse({
      ...base,
      type: "message_update",
      textDelta: "",
    });
    expect(result.textDelta).toBe("");
  });

  it("rejects missing textDelta", () => {
    expect(() => AgentMessageUpdateSchema.parse({ ...base, type: "message_update" })).toThrow();
  });
});

describe("AgentMessageEndSchema", () => {
  it("parses valid message_end", () => {
    const result = AgentMessageEndSchema.parse({ ...base, type: "message_end" });
    expect(result.type).toBe("message_end");
  });
});

describe("AgentToolExecutionStartSchema", () => {
  it("parses valid tool_execution_start", () => {
    const result = AgentToolExecutionStartSchema.parse({
      ...base,
      type: "tool_execution_start",
      toolCallId: "tc_001",
      toolName: "Read",
    });
    expect(result.toolName).toBe("Read");
  });

  it("rejects empty toolCallId", () => {
    expect(() =>
      AgentToolExecutionStartSchema.parse({
        ...base,
        type: "tool_execution_start",
        toolCallId: "",
        toolName: "Read",
      }),
    ).toThrow();
  });
});

describe("AgentToolExecutionUpdateSchema", () => {
  it("parses valid tool_execution_update", () => {
    const result = AgentToolExecutionUpdateSchema.parse({
      ...base,
      type: "tool_execution_update",
      toolCallId: "tc_001",
      toolName: "Read",
    });
    expect(result.type).toBe("tool_execution_update");
  });
});

describe("AgentToolExecutionEndSchema", () => {
  it("parses valid tool_execution_end", () => {
    const result = AgentToolExecutionEndSchema.parse({
      ...base,
      type: "tool_execution_end",
      toolCallId: "tc_001",
      toolName: "Read",
      isError: false,
      durationMs: 150,
    });
    expect(result.durationMs).toBe(150);
    expect(result.isError).toBe(false);
  });

  it("rejects negative durationMs", () => {
    expect(() =>
      AgentToolExecutionEndSchema.parse({
        ...base,
        type: "tool_execution_end",
        toolCallId: "tc_001",
        toolName: "Read",
        isError: false,
        durationMs: -1,
      }),
    ).toThrow();
  });
});

describe("AgentEventSchema (discriminated union)", () => {
  it("routes turn_start correctly", () => {
    const event = AgentEventSchema.parse({ ...base, type: "turn_start" });
    expect(event.type).toBe("turn_start");
  });

  it("routes tool_execution_end correctly", () => {
    const event = AgentEventSchema.parse({
      ...base,
      type: "tool_execution_end",
      toolCallId: "tc_001",
      toolName: "Bash",
      isError: true,
      durationMs: 500,
    });
    expect(event.type).toBe("tool_execution_end");
  });

  it("routes message_update correctly", () => {
    const event = AgentEventSchema.parse({
      ...base,
      type: "message_update",
      textDelta: "chunk",
    });
    expect(event.type).toBe("message_update");
  });

  it("rejects unknown type", () => {
    expect(() => AgentEventSchema.parse({ ...base, type: "unknown_event" })).toThrow();
  });

  it("rejects invalid taskId", () => {
    expect(() =>
      AgentEventSchema.parse({
        taskId: "not-uuid",
        turnIndex: 0,
        timestamp: NOW,
        type: "turn_start",
      }),
    ).toThrow();
  });
});

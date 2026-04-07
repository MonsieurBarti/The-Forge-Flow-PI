import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { AgentCostSchema, AgentResultSchema } from "./agent-result.schema";

const ALL_PASSED_DIMS = [
  { dimension: "completeness" as const, passed: true },
  { dimension: "quality" as const, passed: true },
  { dimension: "discipline" as const, passed: true },
  { dimension: "verification" as const, passed: true },
];

describe("AgentCostSchema", () => {
  it("parses valid cost", () => {
    const cost = AgentCostSchema.parse({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      inputTokens: 1500,
      outputTokens: 800,
      costUsd: 0.015,
    });
    expect(cost.inputTokens).toBe(1500);
  });

  it("rejects negative token counts", () => {
    expect(() =>
      AgentCostSchema.parse({
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        inputTokens: -1,
        outputTokens: 800,
        costUsd: 0.015,
      }),
    ).toThrow();
  });

  it("rejects non-integer tokens", () => {
    expect(() =>
      AgentCostSchema.parse({
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        inputTokens: 1.5,
        outputTokens: 800,
        costUsd: 0.015,
      }),
    ).toThrow();
  });
});

describe("AgentResultSchema", () => {
  it("parses valid result with DONE status", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "tff-code-reviewer",
      status: "DONE",
      output: "Review complete. No issues found.",
      selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
      cost: {
        provider: "anthropic",
        modelId: "claude-opus-4-6",
        inputTokens: 5000,
        outputTokens: 2000,
        costUsd: 0.1,
      },
      durationMs: 45000,
    });
    expect(result.filesChanged).toEqual([]);
    expect(result.concerns).toEqual([]);
    expect(result.status).toBe("DONE");
    expect(result.error).toBeUndefined();
  });

  it("parses BLOCKED result with error", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "tff-fixer",
      status: "BLOCKED",
      output: "",
      selfReview: {
        dimensions: ALL_PASSED_DIMS.map((d) => ({ ...d, passed: false })),
        overallConfidence: "low",
      },
      cost: {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
      },
      durationMs: 1000,
      error: "Test suite failed after fix attempt",
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.error).toBe("Test suite failed after fix attempt");
  });

  it("rejects negative durationMs", () => {
    expect(() =>
      AgentResultSchema.parse({
        taskId: faker.string.uuid(),
        agentType: "tff-fixer",
        status: "DONE",
        output: "Done",
        selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
        cost: {
          provider: "anthropic",
          modelId: "claude-sonnet-4-6",
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.001,
        },
        durationMs: -1,
      }),
    ).toThrow();
  });

  it("defaults turns to empty array", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "tff-fixer",
      status: "DONE",
      output: "Done",
      selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
      cost: {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
      },
      durationMs: 1000,
    });
    expect(result.turns).toEqual([]);
  });

  it("parses result with turn metrics", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "tff-fixer",
      status: "DONE",
      output: "Done",
      selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
      cost: {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
      },
      durationMs: 5000,
      turns: [
        {
          turnIndex: 0,
          toolCalls: [{ toolCallId: "tc_1", toolName: "Read", durationMs: 50, isError: false }],
          durationMs: 3000,
        },
        { turnIndex: 1, durationMs: 2000 },
      ],
    });
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0].toolCalls).toHaveLength(1);
    expect(result.turns[1].toolCalls).toEqual([]);
  });
});

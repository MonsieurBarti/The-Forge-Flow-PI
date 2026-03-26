import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { AgentCostSchema, AgentResultSchema } from "./agent-result.schema";

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
  it("parses valid result", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "code-reviewer",
      success: true,
      output: "Review complete. No issues found.",
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
    expect(result.error).toBeUndefined();
  });

  it("parses failed result with error", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "fixer",
      success: false,
      output: "",
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
    expect(result.success).toBe(false);
    expect(result.error).toBe("Test suite failed after fix attempt");
  });

  it("rejects negative durationMs", () => {
    expect(() =>
      AgentResultSchema.parse({
        taskId: faker.string.uuid(),
        agentType: "fixer",
        success: true,
        output: "Done",
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
});

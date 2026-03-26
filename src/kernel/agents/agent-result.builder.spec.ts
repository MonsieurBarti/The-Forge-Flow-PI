import { describe, expect, it } from "vitest";
import { AgentResultSchema } from "./agent-result.schema";
import { AgentResultBuilder } from "./agent-result.builder";

describe("AgentResultBuilder", () => {
  it("builds valid result with defaults", () => {
    const result = new AgentResultBuilder().build();
    expect(() => AgentResultSchema.parse(result)).not.toThrow();
    expect(result.success).toBe(true);
  });

  it("builds failure result with withFailure()", () => {
    const result = new AgentResultBuilder()
      .withFailure("Test suite failed")
      .build();
    expect(result.success).toBe(false);
    expect(result.error).toBe("Test suite failed");
  });

  it("overrides agentType", () => {
    const result = new AgentResultBuilder()
      .withAgentType("security-auditor")
      .build();
    expect(result.agentType).toBe("security-auditor");
  });

  it("overrides filesChanged", () => {
    const result = new AgentResultBuilder()
      .withFilesChanged(["src/a.ts", "src/b.ts"])
      .build();
    expect(result.filesChanged).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("overrides cost", () => {
    const cost = {
      provider: "anthropic",
      modelId: "claude-opus-4-6",
      inputTokens: 10000,
      outputTokens: 5000,
      costUsd: 0.5,
    };
    const result = new AgentResultBuilder().withCost(cost).build();
    expect(result.cost).toEqual(cost);
  });

  it("is chainable", () => {
    const result = new AgentResultBuilder()
      .withAgentType("fixer")
      .withOutput("Fixed the bug")
      .withDurationMs(5000)
      .build();
    expect(result.agentType).toBe("fixer");
    expect(result.output).toBe("Fixed the bug");
    expect(result.durationMs).toBe(5000);
  });
});

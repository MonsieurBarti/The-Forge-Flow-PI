import { describe, expect, it } from "vitest";
import { AgentResultBuilder } from "./agent-result.builder";
import { AgentResultSchema } from "./agent-result.schema";

describe("AgentResultBuilder", () => {
  it("builds valid result with defaults", () => {
    const result = new AgentResultBuilder().build();
    expect(() => AgentResultSchema.parse(result)).not.toThrow();
    expect(result.status).toBe("DONE");
    expect(result.concerns).toEqual([]);
    expect(result.selfReview.overallConfidence).toBe("high");
  });

  it("builds BLOCKED result with asBlocked()", () => {
    const result = new AgentResultBuilder().asBlocked("Test suite failed").build();
    expect(result.status).toBe("BLOCKED");
    expect(result.error).toBe("Test suite failed");
  });

  it("builds DONE_WITH_CONCERNS with asDoneWithConcerns()", () => {
    const concerns = [
      { area: "tests", description: "Missing edge case", severity: "warning" as const },
    ];
    const result = new AgentResultBuilder().asDoneWithConcerns(concerns).build();
    expect(result.status).toBe("DONE_WITH_CONCERNS");
    expect(result.concerns).toEqual(concerns);
  });

  it("builds NEEDS_CONTEXT with asNeedsContext()", () => {
    const result = new AgentResultBuilder().asNeedsContext("Need DB schema").build();
    expect(result.status).toBe("NEEDS_CONTEXT");
    expect(result.error).toBe("Need DB schema");
  });

  it("overrides agentType", () => {
    const result = new AgentResultBuilder().withAgentType("security-auditor").build();
    expect(result.agentType).toBe("security-auditor");
  });

  it("overrides filesChanged", () => {
    const result = new AgentResultBuilder().withFilesChanged(["src/a.ts", "src/b.ts"]).build();
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

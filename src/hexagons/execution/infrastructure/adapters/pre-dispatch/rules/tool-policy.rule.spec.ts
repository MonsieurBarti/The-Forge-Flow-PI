import { describe, expect, it } from "vitest";
import type { PreDispatchContext } from "../../../../domain/pre-dispatch.schemas";
import { ToolPolicyRule } from "./tool-policy.rule";

function makeContext(overrides: Partial<PreDispatchContext> = {}): PreDispatchContext {
  return {
    taskId: "T01",
    sliceId: "S01",
    milestoneId: "M01",
    taskFilePaths: [],
    sliceFilePaths: [],
    expectedBranch: "slice/M01-S01",
    agentModel: "claude-sonnet",
    agentTools: [],
    upstreamTasks: [],
    ...overrides,
  };
}

describe("ToolPolicyRule", () => {
  it("returns blocker when agentTools contains disallowed tool", async () => {
    const allowed = new Map([["claude-sonnet", ["Read", "Write"]]]);
    const rule = new ToolPolicyRule(allowed);

    const violations = await rule.evaluate(
      makeContext({
        agentModel: "claude-sonnet",
        agentTools: ["Read", "Bash"],
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe("tool-policy");
    expect(violations[0].severity).toBe("blocker");
    expect(violations[0].message).toContain("Bash");
    expect(violations[0].message).toContain("claude-sonnet");
  });

  it("returns empty when agentTools are all allowed", async () => {
    const allowed = new Map([["claude-sonnet", ["Read", "Write", "Bash"]]]);
    const rule = new ToolPolicyRule(allowed);

    const violations = await rule.evaluate(
      makeContext({
        agentModel: "claude-sonnet",
        agentTools: ["Read", "Write"],
      }),
    );
    expect(violations).toEqual([]);
  });

  it("returns empty when no policy defined for the agent model", async () => {
    const rule = new ToolPolicyRule();

    const violations = await rule.evaluate(
      makeContext({
        agentModel: "claude-sonnet",
        agentTools: ["Read", "Bash", "Write"],
      }),
    );
    expect(violations).toEqual([]);
  });

  it("returns multiple violations for multiple disallowed tools", async () => {
    const allowed = new Map([["claude-sonnet", ["Read"]]]);
    const rule = new ToolPolicyRule(allowed);

    const violations = await rule.evaluate(
      makeContext({
        agentModel: "claude-sonnet",
        agentTools: ["Read", "Bash", "Write"],
      }),
    );
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("Bash"), expect.stringContaining("Write")]),
    );
  });
});

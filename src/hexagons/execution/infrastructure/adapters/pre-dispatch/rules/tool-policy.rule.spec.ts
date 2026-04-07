import type { ToolPoliciesConfig } from "@hexagons/settings/domain/project-settings.schemas";
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
  it("returns empty violations when config is empty (permissive)", async () => {
    const rule = new ToolPolicyRule();

    const violations = await rule.evaluate(makeContext({ agentTools: ["Read", "Bash", "Write"] }));
    expect(violations).toEqual([]);
  });

  it("blocks tools listed in defaults.blocked", async () => {
    const config: ToolPoliciesConfig = {
      defaults: { blocked: ["Bash"] },
      byTier: {},
      byRole: {},
    };
    const rule = new ToolPolicyRule(config);

    const violations = await rule.evaluate(makeContext({ agentTools: ["Read", "Bash"] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("blocker");
    expect(violations[0].message).toContain("Bash");
    expect(violations[0].message).toContain("blocked");
  });

  it("defaults.blocked accumulates with byRole.blocked", async () => {
    const config: ToolPoliciesConfig = {
      defaults: { blocked: ["Bash"] },
      byTier: {},
      byRole: {
        "tff-security-auditor": { blocked: ["Write"] },
      },
    };
    const rule = new ToolPolicyRule(config);

    const violations = await rule.evaluate(
      makeContext({
        agentRole: "tff-security-auditor",
        agentTools: ["Read", "Bash", "Write"],
      }),
    );
    expect(violations).toHaveLength(2);
    const messages = violations.map((v) => v.message);
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining("Bash"), expect.stringContaining("Write")]),
    );
  });

  it("allowed list restricts (whitelist behavior)", async () => {
    const config: ToolPoliciesConfig = {
      defaults: { allowed: ["Read", "Grep"] },
      byTier: {},
      byRole: {},
    };
    const rule = new ToolPolicyRule(config);

    const violations = await rule.evaluate(makeContext({ agentTools: ["Read", "Bash", "Write"] }));
    expect(violations).toHaveLength(2);
    const messages = violations.map((v) => v.message);
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining("Bash"), expect.stringContaining("Write")]),
    );
    // Read is allowed, so no violation for it
    expect(messages.some((m) => m.includes("Read"))).toBe(false);
  });

  it("merge chain: defaults -> byTier -> byRole", async () => {
    const config: ToolPoliciesConfig = {
      defaults: { blocked: ["Bash"] },
      byTier: {
        S: { blocked: ["Write"] },
      },
      byRole: {
        reviewer: { blocked: ["Edit"] },
      },
    };
    const rule = new ToolPolicyRule(config);

    const violations = await rule.evaluate(
      makeContext({
        complexityTier: "S",
        agentRole: "reviewer",
        agentTools: ["Read", "Bash", "Write", "Edit", "Grep"],
      }),
    );
    expect(violations).toHaveLength(3);
    const messages = violations.map((v) => v.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Bash"),
        expect.stringContaining("Write"),
        expect.stringContaining("Edit"),
      ]),
    );
  });

  it("role-specific allowed overrides (security-auditor gets Read/Grep/Glob only)", async () => {
    const config: ToolPoliciesConfig = {
      defaults: {},
      byTier: {},
      byRole: {
        "tff-security-auditor": { allowed: ["Read", "Grep", "Glob"] },
      },
    };
    const rule = new ToolPolicyRule(config);

    const violations = await rule.evaluate(
      makeContext({
        agentRole: "tff-security-auditor",
        agentTools: ["Read", "Grep", "Glob", "Bash", "Write"],
      }),
    );
    expect(violations).toHaveLength(2);
    const messages = violations.map((v) => v.message);
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining("Bash"), expect.stringContaining("Write")]),
    );
    // Allowed tools produce no violations
    expect(messages.some((m) => m.includes("Read"))).toBe(false);
    expect(messages.some((m) => m.includes("Grep"))).toBe(false);
    expect(messages.some((m) => m.includes("Glob"))).toBe(false);
  });

  it("byTier allowed narrows then byRole allowed overrides", async () => {
    const config: ToolPoliciesConfig = {
      defaults: {},
      byTier: {
        S: { allowed: ["Read", "Write", "Grep"] },
      },
      byRole: {
        reviewer: { allowed: ["Read", "Grep"] },
      },
    };
    const rule = new ToolPolicyRule(config);

    const violations = await rule.evaluate(
      makeContext({
        complexityTier: "S",
        agentRole: "reviewer",
        agentTools: ["Read", "Write", "Grep"],
      }),
    );
    // byRole allowed ["Read", "Grep"] overrides byTier, so Write is not allowed
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("Write");
  });

  it("returns no violations when no tier or role match and defaults are empty", async () => {
    const config: ToolPoliciesConfig = {
      defaults: {},
      byTier: {
        "F-full": { blocked: ["Bash"] },
      },
      byRole: {
        admin: { blocked: ["Write"] },
      },
    };
    const rule = new ToolPolicyRule(config);

    const violations = await rule.evaluate(
      makeContext({
        complexityTier: "S",
        agentRole: "developer",
        agentTools: ["Read", "Bash", "Write"],
      }),
    );
    expect(violations).toEqual([]);
  });

  it("blocked and allowed interact: tool both blocked and not in allowed gets one violation", async () => {
    const config: ToolPoliciesConfig = {
      defaults: { blocked: ["Bash"], allowed: ["Read", "Grep"] },
      byTier: {},
      byRole: {},
    };
    const rule = new ToolPolicyRule(config);

    const violations = await rule.evaluate(makeContext({ agentTools: ["Read", "Bash"] }));
    // Bash is blocked so the blocked check fires first
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("Bash");
    expect(violations[0].message).toContain("blocked");
  });
});

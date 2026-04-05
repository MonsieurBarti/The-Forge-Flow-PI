import { describe, expect, it } from "vitest";
import type { PreDispatchContext } from "../../../../domain/pre-dispatch.schemas";
import { BudgetCheckRule } from "./budget-check.rule";

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

describe("BudgetCheckRule", () => {
  const rule = new BudgetCheckRule();

  it("returns warning when budgetRemaining < budgetEstimated", async () => {
    const violations = await rule.evaluate(makeContext({
      budgetRemaining: 5,
      budgetEstimated: 10,
    }));
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe("budget-check");
    expect(violations[0].severity).toBe("warning");
    expect(violations[0].message).toContain("5 remaining");
    expect(violations[0].message).toContain("10 estimated");
  });

  it("returns empty when budgetRemaining >= budgetEstimated", async () => {
    const violations = await rule.evaluate(makeContext({
      budgetRemaining: 10,
      budgetEstimated: 5,
    }));
    expect(violations).toEqual([]);
  });

  it("returns empty when budgetRemaining is undefined", async () => {
    const violations = await rule.evaluate(makeContext({
      budgetRemaining: undefined,
      budgetEstimated: 10,
    }));
    expect(violations).toEqual([]);
  });

  it("returns empty when budgetEstimated is undefined", async () => {
    const violations = await rule.evaluate(makeContext({
      budgetRemaining: 10,
      budgetEstimated: undefined,
    }));
    expect(violations).toEqual([]);
  });
});

import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import type {
  PreDispatchContext,
  PreDispatchReport,
  PreDispatchViolation,
} from "../../../domain/pre-dispatch.schemas";
import type { PreDispatchGuardrailRule } from "../../../domain/pre-dispatch-guardrail-rule";
import { ComposablePreDispatchAdapter } from "./composable-pre-dispatch.adapter";
import { InMemoryPreDispatchAdapter } from "./in-memory-pre-dispatch.adapter";

function makeContext(overrides: Partial<PreDispatchContext> = {}): PreDispatchContext {
  return {
    taskId: "task-1",
    sliceId: "slice-1",
    milestoneId: "milestone-1",
    taskFilePaths: ["src/foo.ts"],
    sliceFilePaths: ["src/foo.ts", "src/bar.ts"],
    expectedBranch: "slice/M01-S01",
    agentModel: "claude-sonnet-4-20250514",
    agentTools: ["Read", "Write"],
    upstreamTasks: [],
    ...overrides,
  };
}

function makeRule(id: string, violations: PreDispatchViolation[]): PreDispatchGuardrailRule {
  return {
    id,
    evaluate: async () => violations,
  };
}

describe("ComposablePreDispatchAdapter", () => {
  it("runs all rules and collects all violations (no short-circuit)", async () => {
    const rule1 = makeRule("rule-1", [
      { ruleId: "rule-1", severity: "warning", message: "warn from rule-1" },
    ]);
    const rule2 = makeRule("rule-2", [
      { ruleId: "rule-2", severity: "warning", message: "warn from rule-2" },
    ]);
    const adapter = new ComposablePreDispatchAdapter([rule1, rule2]);

    const result = await adapter.validate(makeContext());

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data.violations).toHaveLength(2);
    expect(result.data.violations[0].ruleId).toBe("rule-1");
    expect(result.data.violations[1].ruleId).toBe("rule-2");
  });

  it("returns passed = true when zero blockers (only warnings)", async () => {
    const rule = makeRule("warn-rule", [
      { ruleId: "warn-rule", severity: "warning", message: "just a warning" },
    ]);
    const adapter = new ComposablePreDispatchAdapter([rule]);

    const result = await adapter.validate(makeContext());

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data.passed).toBe(true);
  });

  it("returns passed = false when any blocker exists", async () => {
    const rule = makeRule("block-rule", [
      { ruleId: "block-rule", severity: "blocker", message: "blocked" },
    ]);
    const adapter = new ComposablePreDispatchAdapter([rule]);

    const result = await adapter.validate(makeContext());

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data.passed).toBe(false);
  });

  it("returns passed = true with no violations when rules array is empty", async () => {
    const adapter = new ComposablePreDispatchAdapter([]);

    const result = await adapter.validate(makeContext());

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data.passed).toBe(true);
    expect(result.data.violations).toHaveLength(0);
  });

  it("sets checkedAt to a valid ISO datetime string", async () => {
    const adapter = new ComposablePreDispatchAdapter([]);

    const result = await adapter.validate(makeContext());

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(new Date(result.data.checkedAt).toISOString()).toBe(result.data.checkedAt);
  });
});

describe("InMemoryPreDispatchAdapter", () => {
  it("returns default passing report", async () => {
    const adapter = new InMemoryPreDispatchAdapter();

    const result = await adapter.validate(makeContext());

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data.passed).toBe(true);
    expect(result.data.violations).toHaveLength(0);
  });

  it("returns preset report after setReport", async () => {
    const adapter = new InMemoryPreDispatchAdapter();
    const preset: PreDispatchReport = {
      passed: false,
      violations: [{ ruleId: "custom", severity: "blocker", message: "custom blocker" }],
      checkedAt: "2026-04-05T00:00:00.000Z",
    };
    adapter.setReport(preset);

    const result = await adapter.validate(makeContext());

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toEqual(preset);
  });
});

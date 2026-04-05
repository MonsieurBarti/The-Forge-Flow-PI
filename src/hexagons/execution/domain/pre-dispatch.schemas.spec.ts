import { describe, expect, it } from "vitest";
import {
  PreDispatchContextSchema,
  PreDispatchReportSchema,
  PreDispatchViolationSchema,
} from "./pre-dispatch.schemas";

describe("PreDispatchContextSchema", () => {
  const validContext = {
    taskId: "task-1",
    sliceId: "slice-1",
    milestoneId: "milestone-1",
    taskFilePaths: ["src/foo.ts"],
    sliceFilePaths: ["src/foo.ts", "src/bar.ts"],
    expectedBranch: "slice/M07-S06",
    agentModel: "claude-sonnet-4-20250514",
    agentTools: ["Read", "Write", "Bash"],
    upstreamTasks: [{ id: "task-0", status: "completed" }],
  };

  it("validates a well-formed context", () => {
    const result = PreDispatchContextSchema.safeParse(validContext);
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = PreDispatchContextSchema.safeParse({
      ...validContext,
      worktreePath: "/tmp/worktree",
      budgetRemaining: 500,
      budgetEstimated: 200,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { taskId, ...missing } = validContext;
    expect(PreDispatchContextSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects missing sliceId", () => {
    const { sliceId, ...missing } = validContext;
    expect(PreDispatchContextSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects missing expectedBranch", () => {
    const { expectedBranch, ...missing } = validContext;
    expect(PreDispatchContextSchema.safeParse(missing).success).toBe(false);
  });
});

describe("PreDispatchViolationSchema", () => {
  it("accepts blocker severity", () => {
    const result = PreDispatchViolationSchema.safeParse({
      ruleId: "scope-containment",
      severity: "blocker",
      message: "Task files outside slice scope",
    });
    expect(result.success).toBe(true);
  });

  it("accepts warning severity", () => {
    const result = PreDispatchViolationSchema.safeParse({
      ruleId: "budget-check",
      severity: "warning",
      message: "Budget low",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional metadata", () => {
    const result = PreDispatchViolationSchema.safeParse({
      ruleId: "dependency-check",
      severity: "blocker",
      message: "Upstream task not completed",
      metadata: { taskId: "task-0", status: "in-progress" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty message", () => {
    const result = PreDispatchViolationSchema.safeParse({
      ruleId: "scope-containment",
      severity: "blocker",
      message: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid severity", () => {
    const result = PreDispatchViolationSchema.safeParse({
      ruleId: "scope-containment",
      severity: "error",
      message: "Invalid severity",
    });
    expect(result.success).toBe(false);
  });
});

describe("PreDispatchReportSchema", () => {
  it("accepts a passed report with no violations", () => {
    const result = PreDispatchReportSchema.safeParse({
      passed: true,
      violations: [],
      checkedAt: "2026-04-05T12:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a failed report with violations", () => {
    const result = PreDispatchReportSchema.safeParse({
      passed: false,
      violations: [
        {
          ruleId: "scope-containment",
          severity: "blocker",
          message: "File outside scope",
        },
      ],
      checkedAt: "2026-04-05T12:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid checkedAt format", () => {
    const result = PreDispatchReportSchema.safeParse({
      passed: true,
      violations: [],
      checkedAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});

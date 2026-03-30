import { describe, expect, it } from "vitest";
import { CleanupReportSchema, WorktreeHealthSchema, WorktreeInfoSchema } from "./worktree.schemas";

describe("WorktreeInfoSchema", () => {
  it("parses valid worktree info", () => {
    const result = WorktreeInfoSchema.safeParse({
      sliceId: "M04-S04",
      branch: "slice/M04-S04",
      path: "/abs/path/.tff/worktrees/M04-S04",
      baseBranch: "milestone/M04",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing sliceId", () => {
    const result = WorktreeInfoSchema.safeParse({
      branch: "slice/M04-S04",
      path: "/abs/path",
      baseBranch: "milestone/M04",
    });
    expect(result.success).toBe(false);
  });
});

describe("WorktreeHealthSchema", () => {
  it("parses valid health check", () => {
    const result = WorktreeHealthSchema.safeParse({
      sliceId: "M04-S04",
      exists: true,
      branchValid: true,
      clean: true,
      reachable: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("CleanupReportSchema", () => {
  it("parses valid cleanup report", () => {
    const result = CleanupReportSchema.safeParse({
      deleted: ["M04-S01"],
      skipped: ["M04-S02"],
      errors: [{ sliceId: "M04-S03", reason: "failed to delete" }],
    });
    expect(result.success).toBe(true);
  });
});

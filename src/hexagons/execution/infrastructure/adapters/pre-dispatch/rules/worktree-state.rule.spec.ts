import { describe, expect, it } from "vitest";
import type { PreDispatchContext } from "../../../../domain/pre-dispatch.schemas";
import { type WorktreeStateGitOps, WorktreeStateRule } from "./worktree-state.rule";

function makeContext(overrides: Partial<PreDispatchContext> = {}): PreDispatchContext {
  return {
    taskId: "10000001-0000-4000-a000-000000000001",
    sliceId: "S06",
    milestoneId: "M07",
    taskFilePaths: [],
    sliceFilePaths: [],
    worktreePath: "/tmp/wt",
    expectedBranch: "slice/M07-S06",
    agentModel: "opus",
    agentTools: [],
    upstreamTasks: [],
    ...overrides,
  };
}

function makeGit(branch: string, clean: boolean): WorktreeStateGitOps {
  return {
    statusAt: async () => ({ ok: true as const, value: { branch, clean } }),
  };
}

function makeFailingGit(): WorktreeStateGitOps {
  return {
    statusAt: async () => ({ ok: false as const, error: new Error("not a git repo") }),
  };
}

describe("WorktreeStateRule", () => {
  it("returns empty when worktreePath is undefined (skip)", async () => {
    const rule = new WorktreeStateRule(makeGit("main", true));
    const violations = await rule.evaluate(makeContext({ worktreePath: undefined }));
    expect(violations).toEqual([]);
  });

  it("returns empty when branch matches and worktree is clean", async () => {
    const rule = new WorktreeStateRule(makeGit("slice/M07-S06", true));
    const violations = await rule.evaluate(makeContext());
    expect(violations).toEqual([]);
  });

  it("returns blocker when branch does not match", async () => {
    const rule = new WorktreeStateRule(makeGit("main", true));
    const violations = await rule.evaluate(makeContext());
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      ruleId: "worktree-state",
      severity: "blocker",
      message: 'Wrong branch: expected "slice/M07-S06", got "main"',
    });
  });

  it("returns blocker when worktree has uncommitted changes", async () => {
    const rule = new WorktreeStateRule(makeGit("slice/M07-S06", false));
    const violations = await rule.evaluate(makeContext());
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      ruleId: "worktree-state",
      severity: "blocker",
      message: "Worktree has uncommitted changes",
    });
  });

  it("returns both violations when branch wrong AND dirty", async () => {
    const rule = new WorktreeStateRule(makeGit("main", false));
    const violations = await rule.evaluate(makeContext());
    expect(violations).toHaveLength(2);
    expect(violations[0].message).toContain("Wrong branch");
    expect(violations[1].message).toContain("uncommitted changes");
  });

  it("returns blocker when git status fails", async () => {
    const rule = new WorktreeStateRule(makeFailingGit());
    const violations = await rule.evaluate(makeContext());
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      ruleId: "worktree-state",
      severity: "blocker",
      message: 'Failed to read worktree status at "/tmp/wt"',
    });
  });
});

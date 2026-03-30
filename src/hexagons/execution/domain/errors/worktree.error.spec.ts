import { describe, expect, it } from "vitest";
import { WorktreeError } from "./worktree.error";

describe("WorktreeError", () => {
  it("creationFailed includes sliceId and cause", () => {
    const e = WorktreeError.creationFailed("M04-S04", "git error");
    expect(e.code).toBe("WORKTREE.CREATION_FAILED");
    expect(e.message).toContain("M04-S04");
    expect(e.metadata?.sliceId).toBe("M04-S04");
  });

  it("notFound includes sliceId", () => {
    const e = WorktreeError.notFound("M04-S04");
    expect(e.code).toBe("WORKTREE.NOT_FOUND");
    expect(e.metadata?.sliceId).toBe("M04-S04");
  });

  it("alreadyExists includes sliceId", () => {
    const e = WorktreeError.alreadyExists("M04-S04");
    expect(e.code).toBe("WORKTREE.ALREADY_EXISTS");
  });

  it("deletionFailed includes sliceId and cause", () => {
    const e = WorktreeError.deletionFailed("M04-S04", "branch unmerged");
    expect(e.code).toBe("WORKTREE.DELETION_FAILED");
  });

  it("unhealthy includes health in metadata", () => {
    const health = {
      sliceId: "id",
      exists: false,
      branchValid: true,
      clean: true,
      reachable: true,
    };
    const e = WorktreeError.unhealthy("M04-S04", health);
    expect(e.code).toBe("WORKTREE.UNHEALTHY");
    expect(e.metadata?.health).toEqual(health);
  });

  it("branchConflict includes branch name", () => {
    const e = WorktreeError.branchConflict("M04-S04", "slice/M04-S04");
    expect(e.code).toBe("WORKTREE.BRANCH_CONFLICT");
  });

  it("operationFailed includes operation name", () => {
    const e = WorktreeError.operationFailed("list", "git error");
    expect(e.code).toBe("WORKTREE.OPERATION_FAILED");
    expect(e.metadata?.operation).toBe("list");
  });

  it("extends Error", () => {
    const e = WorktreeError.notFound("x");
    expect(e).toBeInstanceOf(Error);
  });
});

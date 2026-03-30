import { describe, expect, it } from "vitest";
import { ExecutionError } from "./execution.error";

describe("ExecutionError", () => {
  it("noTasks includes sliceId in code and metadata", () => {
    const e = ExecutionError.noTasks("slice-1");
    expect(e.code).toBe("EXECUTION.NO_TASKS");
    expect(e.message).toContain("slice-1");
    expect(e.metadata?.sliceId).toBe("slice-1");
  });

  it("cyclicDependency", () => {
    const e = ExecutionError.cyclicDependency("slice-1");
    expect(e.code).toBe("EXECUTION.CYCLIC_DEPENDENCY");
    expect(e.metadata?.sliceId).toBe("slice-1");
  });

  it("worktreeRequired", () => {
    const e = ExecutionError.worktreeRequired("slice-1");
    expect(e.code).toBe("EXECUTION.WORKTREE_REQUIRED");
    expect(e.metadata?.sliceId).toBe("slice-1");
  });

  it("extends Error", () => {
    expect(ExecutionError.noTasks("x")).toBeInstanceOf(Error);
  });
});

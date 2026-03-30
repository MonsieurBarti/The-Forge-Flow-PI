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

  it("waveFailed includes waveIndex and failedTaskIds", () => {
    const e = ExecutionError.waveFailed("slice-1", 2, ["t1", "t2"]);
    expect(e.code).toBe("EXECUTION.WAVE_FAILED");
    expect(e.metadata?.waveIndex).toBe(2);
    expect(e.metadata?.failedTaskIds).toEqual(["t1", "t2"]);
  });

  it("staleClaim includes taskId", () => {
    const e = ExecutionError.staleClaim("task-1");
    expect(e.code).toBe("EXECUTION.STALE_CLAIM");
    expect(e.metadata?.taskId).toBe("task-1");
  });

  it("extends Error", () => {
    expect(ExecutionError.noTasks("x")).toBeInstanceOf(Error);
  });
});

import { BaseDomainError } from "@kernel";

export class ExecutionError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static noTasks(sliceId: string): ExecutionError {
    return new ExecutionError("EXECUTION.NO_TASKS", `No tasks found for slice ${sliceId}`, {
      sliceId,
    });
  }

  static cyclicDependency(sliceId: string): ExecutionError {
    return new ExecutionError(
      "EXECUTION.CYCLIC_DEPENDENCY",
      `Cyclic task dependency in slice ${sliceId}`,
      { sliceId },
    );
  }

  static worktreeRequired(sliceId: string): ExecutionError {
    return new ExecutionError(
      "EXECUTION.WORKTREE_REQUIRED",
      `Worktree missing for non-S-tier slice ${sliceId}`,
      { sliceId },
    );
  }
}

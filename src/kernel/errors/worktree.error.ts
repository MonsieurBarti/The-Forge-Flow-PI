import { BaseDomainError } from "@kernel/errors";
import type { WorktreeHealth } from "@kernel/ports/worktree.schemas";

export class WorktreeError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static creationFailed(sliceId: string, cause: unknown): WorktreeError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new WorktreeError(
      "WORKTREE.CREATION_FAILED",
      `Failed to create worktree for slice ${sliceId}: ${msg}`,
      { sliceId, cause: msg },
    );
  }

  static deletionFailed(sliceId: string, cause: unknown): WorktreeError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new WorktreeError(
      "WORKTREE.DELETION_FAILED",
      `Failed to delete worktree for slice ${sliceId}: ${msg}`,
      { sliceId, cause: msg },
    );
  }

  static notFound(sliceId: string): WorktreeError {
    return new WorktreeError("WORKTREE.NOT_FOUND", `No worktree found for slice ${sliceId}`, {
      sliceId,
    });
  }

  static alreadyExists(sliceId: string): WorktreeError {
    return new WorktreeError(
      "WORKTREE.ALREADY_EXISTS",
      `Worktree already exists for slice ${sliceId}`,
      { sliceId },
    );
  }

  static unhealthy(sliceId: string, health: WorktreeHealth): WorktreeError {
    return new WorktreeError("WORKTREE.UNHEALTHY", `Worktree for slice ${sliceId} is unhealthy`, {
      sliceId,
      health,
    });
  }

  static branchConflict(sliceId: string, branch: string): WorktreeError {
    return new WorktreeError(
      "WORKTREE.BRANCH_CONFLICT",
      `Branch ${branch} already in use for slice ${sliceId}`,
      { sliceId, branch },
    );
  }

  static operationFailed(operation: string, cause: unknown): WorktreeError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new WorktreeError(
      "WORKTREE.OPERATION_FAILED",
      `Worktree operation '${operation}' failed: ${msg}`,
      { operation, cause: msg },
    );
  }
}

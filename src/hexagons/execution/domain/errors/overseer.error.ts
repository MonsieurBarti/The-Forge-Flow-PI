import { BaseDomainError } from "@kernel";

export class OverseerError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static timeout(taskId: string, reason: string): OverseerError {
    return new OverseerError("OVERSEER.TIMEOUT", `Overseer timeout for task ${taskId}: ${reason}`, {
      taskId,
      reason,
    });
  }

  static retryLoop(taskId: string, reason: string): OverseerError {
    return new OverseerError(
      "OVERSEER.RETRY_LOOP",
      `Retry loop detected for task ${taskId}: ${reason}`,
      { taskId, reason },
    );
  }

  static abortFailed(taskId: string, cause: unknown): OverseerError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new OverseerError("OVERSEER.ABORT_FAILED", `Failed to abort task ${taskId}: ${msg}`, {
      taskId,
      cause: msg,
    });
  }
}

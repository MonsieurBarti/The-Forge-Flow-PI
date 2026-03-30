import { BaseDomainError } from "@kernel";

export class AgentDispatchError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static sessionCreationFailed(taskId: string, cause: unknown): AgentDispatchError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new AgentDispatchError(
      "AGENT_DISPATCH.SESSION_CREATION_FAILED",
      `Failed to create agent session for task ${taskId}: ${msg}`,
      { taskId, cause: msg },
    );
  }

  static sessionTimedOut(taskId: string, durationMs: number): AgentDispatchError {
    return new AgentDispatchError(
      "AGENT_DISPATCH.SESSION_TIMED_OUT",
      `Agent session timed out for task ${taskId} after ${durationMs}ms`,
      { taskId, durationMs },
    );
  }

  static sessionAborted(taskId: string): AgentDispatchError {
    return new AgentDispatchError(
      "AGENT_DISPATCH.SESSION_ABORTED",
      `Agent session aborted for task ${taskId}`,
      { taskId },
    );
  }

  static unexpectedFailure(taskId: string, cause: unknown): AgentDispatchError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new AgentDispatchError(
      "AGENT_DISPATCH.UNEXPECTED_FAILURE",
      `Unexpected failure in agent session for task ${taskId}: ${msg}`,
      { taskId, cause: msg },
    );
  }
}

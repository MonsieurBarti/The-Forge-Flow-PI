import { BaseDomainError } from "@kernel";

export class AuditError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static agentTimeout(agentType: string, milestoneLabel: string): AuditError {
    return new AuditError(
      "AUDIT.AGENT_TIMEOUT",
      `Audit agent "${agentType}" timed out for milestone ${milestoneLabel}`,
      { agentType, milestoneLabel },
    );
  }

  static parseFailed(agentType: string, rawOutput: string): AuditError {
    return new AuditError(
      "AUDIT.PARSE_FAILED",
      `Failed to parse audit output from "${agentType}"`,
      { agentType, rawOutput: rawOutput.slice(0, 500) },
    );
  }

  static dispatchFailed(agentType: string, cause: unknown): AuditError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new AuditError(
      "AUDIT.DISPATCH_FAILED",
      `Failed to dispatch audit agent "${agentType}": ${msg}`,
      { agentType, cause: msg },
    );
  }
}

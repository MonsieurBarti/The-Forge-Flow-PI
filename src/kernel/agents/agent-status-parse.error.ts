import { BaseDomainError } from "@kernel";

export class AgentStatusParseError extends BaseDomainError {
  readonly code = "AGENT_STATUS.PARSE_FAILED";

  constructor(
    message: string,
    public readonly rawOutput: string,
    cause?: unknown,
  ) {
    super(message);
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

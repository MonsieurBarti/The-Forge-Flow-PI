import { BaseDomainError } from "@kernel";

export class InvalidExecutionSessionStateError extends BaseDomainError {
  readonly code = "EXECUTION_SESSION.INVALID_STATE";
}

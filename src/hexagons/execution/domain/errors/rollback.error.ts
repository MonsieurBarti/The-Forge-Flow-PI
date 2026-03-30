import { BaseDomainError } from "@kernel";

export class RollbackError extends BaseDomainError {
  readonly code = "JOURNAL.ROLLBACK_FAILURE";
}

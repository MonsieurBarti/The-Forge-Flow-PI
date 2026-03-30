import { BaseDomainError } from "@kernel";

export class JournalReadError extends BaseDomainError {
  readonly code = "JOURNAL.READ_FAILURE";
}

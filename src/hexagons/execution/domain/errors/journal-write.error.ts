import { BaseDomainError } from "@kernel";

export class JournalWriteError extends BaseDomainError {
  readonly code = "JOURNAL.WRITE_FAILURE";
}

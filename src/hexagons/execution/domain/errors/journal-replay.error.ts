import { BaseDomainError } from "@kernel";

export class JournalReplayError extends BaseDomainError {
  readonly code = "JOURNAL.REPLAY_FAILURE";
}

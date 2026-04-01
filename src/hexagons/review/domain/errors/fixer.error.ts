import { BaseDomainError } from "@kernel";

export class FixerError extends BaseDomainError {
  readonly code = "REVIEW.FIXER_FAILED";
}

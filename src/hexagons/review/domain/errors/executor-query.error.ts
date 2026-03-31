import { BaseDomainError } from "@kernel";

export class ExecutorQueryError extends BaseDomainError {
  readonly code = "REVIEW.EXECUTOR_QUERY_FAILED";

  constructor(message: string, cause?: Error) {
    super(message, { cause: cause?.message });
  }
}

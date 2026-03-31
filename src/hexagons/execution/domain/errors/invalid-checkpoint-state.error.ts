import { BaseDomainError } from "@kernel";

export class InvalidCheckpointStateError extends BaseDomainError {
  readonly code = "CHECKPOINT.INVALID_STATE";

  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
  }
}

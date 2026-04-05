import { BaseDomainError } from "@kernel";

export class InvalidCheckpointStateError extends BaseDomainError {
  readonly code = "CHECKPOINT.INVALID_STATE";
}

import { BaseDomainError } from "@kernel";

export class CheckpointNotFoundError extends BaseDomainError {
  readonly code = "CHECKPOINT.NOT_FOUND";

  constructor(identifier: string) {
    super(`Checkpoint not found: ${identifier}`, { identifier });
  }
}

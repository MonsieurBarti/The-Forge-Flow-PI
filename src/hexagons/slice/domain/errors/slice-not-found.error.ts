import { BaseDomainError } from "@kernel";

export class SliceNotFoundError extends BaseDomainError {
  readonly code = "SLICE.NOT_FOUND";

  constructor(identifier: string) {
    super(`Slice not found: ${identifier}`, { identifier });
  }
}

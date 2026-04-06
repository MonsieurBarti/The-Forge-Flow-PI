import { BaseDomainError } from "./base-domain.error";

export class SliceTransitionError extends BaseDomainError {
  readonly code = "SLICE_TRANSITION_FAILED";

  constructor(sliceId: string, cause: string) {
    super(`Slice transition failed for '${sliceId}': ${cause}`, { sliceId, cause });
  }
}

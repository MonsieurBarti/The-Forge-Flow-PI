import { BaseDomainError } from "@kernel";

export class SliceSpecError extends BaseDomainError {
  readonly code = "REVIEW.SLICE_SPEC_FAILED";
}

export class ChangedFilesError extends BaseDomainError {
  readonly code = "REVIEW.CHANGED_FILES_FAILED";
}

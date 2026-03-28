import { WorkflowBaseError } from "./workflow-base.error";

export class SliceTransitionError extends WorkflowBaseError {
  readonly code = "WORKFLOW.SLICE_TRANSITION_FAILED";

  constructor(sliceId: string, cause: string) {
    super(`Slice transition failed for '${sliceId}': ${cause}`, { sliceId, cause });
  }
}

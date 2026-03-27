import { WorkflowBaseError } from "./workflow-base.error";

export class SliceAlreadyAssignedError extends WorkflowBaseError {
  readonly code = "WORKFLOW.SLICE_ALREADY_ASSIGNED";

  constructor(currentSliceId: string) {
    super(`Slice already assigned: "${currentSliceId}"`, { currentSliceId });
  }
}

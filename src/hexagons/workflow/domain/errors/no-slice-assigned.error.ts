import { WorkflowBaseError } from "./workflow-base.error";

export class NoSliceAssignedError extends WorkflowBaseError {
  readonly code = "WORKFLOW.NO_SLICE_ASSIGNED";

  constructor() {
    super("No slice assigned to workflow session");
  }
}

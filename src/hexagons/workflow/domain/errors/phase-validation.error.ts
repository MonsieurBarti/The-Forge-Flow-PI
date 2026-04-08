import { WorkflowBaseError } from "./workflow-base.error";

export class PhaseValidationError extends WorkflowBaseError {
  readonly code = "WORKFLOW.PHASE_VALIDATION";

  constructor(toolName: string, expectedStatus: string, currentStatus: string) {
    super(
      `Cannot ${toolName}: slice is not in ${expectedStatus} phase. Current phase: ${currentStatus}. Run the appropriate /tff command first.`,
      { toolName, expectedStatus, currentStatus },
    );
  }
}

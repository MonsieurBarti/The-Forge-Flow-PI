import { WorkflowBaseError } from "./workflow-base.error";

export abstract class ContextStagingError extends WorkflowBaseError {}

export class InvalidPhaseForStagingError extends ContextStagingError {
  readonly code = "CONTEXT_STAGING.INVALID_PHASE";

  constructor(phase: string) {
    super(`Cannot stage context for non-active phase: ${phase}`, { phase });
  }
}

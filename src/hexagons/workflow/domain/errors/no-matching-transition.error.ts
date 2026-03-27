import type { WorkflowPhase, WorkflowTrigger } from "../workflow-session.schemas";
import { WorkflowBaseError } from "./workflow-base.error";

export class NoMatchingTransitionError extends WorkflowBaseError {
  readonly code = "WORKFLOW.NO_MATCHING_TRANSITION";

  constructor(phase: WorkflowPhase | "*active*", trigger: WorkflowTrigger) {
    super(`No transition from "${phase}" with trigger "${trigger}"`, { phase, trigger });
  }
}

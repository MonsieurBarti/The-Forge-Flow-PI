import type { GuardName } from "../workflow-session.schemas";
import { WorkflowBaseError } from "./workflow-base.error";

export class GuardRejectedError extends WorkflowBaseError {
  readonly code = "WORKFLOW.GUARD_REJECTED";

  constructor(phase: string, trigger: string, failedGuards: GuardName[]) {
    super(`All guards rejected for "${phase}" + "${trigger}": [${failedGuards.join(", ")}]`, {
      phase,
      trigger,
      failedGuards,
    });
  }
}

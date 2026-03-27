import type { SliceStatus } from "@hexagons/slice";
import type { WorkflowPhase } from "./workflow-session.schemas";

const PHASE_TO_STATUS: ReadonlyMap<WorkflowPhase, SliceStatus> = new Map([
  ["discussing", "discussing"],
  ["researching", "researching"],
  ["planning", "planning"],
  ["executing", "executing"],
  ["verifying", "verifying"],
  ["reviewing", "reviewing"],
  ["shipping", "completing"],
]);

export function mapPhaseToSliceStatus(phase: WorkflowPhase): SliceStatus | null {
  return PHASE_TO_STATUS.get(phase) ?? null;
}

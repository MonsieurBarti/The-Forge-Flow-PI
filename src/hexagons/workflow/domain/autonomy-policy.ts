import type { AutonomyMode } from "@hexagons/settings";
import { ACTIVE_PHASES } from "./transition-table";
import type { AutoTransitionDecision, WorkflowPhase } from "./workflow-session.schemas";

const PLAN_TO_PR_GATES: ReadonlySet<WorkflowPhase> = new Set(["planning", "reviewing", "shipping"]);

const HUMAN_GATES: Record<AutonomyMode, ReadonlySet<WorkflowPhase>> = {
  guided: ACTIVE_PHASES,
  "plan-to-pr": PLAN_TO_PR_GATES,
};

export function shouldAutoTransition(
  phase: WorkflowPhase,
  mode: AutonomyMode,
): AutoTransitionDecision {
  const gates = HUMAN_GATES[mode];

  if (!ACTIVE_PHASES.has(phase)) {
    return { autoTransition: false, isHumanGate: false };
  }

  if (gates.has(phase)) {
    return { autoTransition: false, isHumanGate: true };
  }

  return { autoTransition: true, isHumanGate: false };
}

export function getHumanGates(mode: AutonomyMode): ReadonlySet<WorkflowPhase> {
  return HUMAN_GATES[mode];
}

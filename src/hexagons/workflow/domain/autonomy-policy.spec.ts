import { describe, expect, it } from "vitest";
import { getHumanGates, shouldAutoTransition } from "./autonomy-policy";
import { ACTIVE_PHASES } from "./transition-table";
import type { WorkflowPhase } from "./workflow-session.schemas";

const NON_ACTIVE_PHASES: WorkflowPhase[] = ["idle", "paused", "blocked", "completing-milestone"];
const PLAN_TO_PR_GATES: WorkflowPhase[] = ["planning", "reviewing", "shipping"];

describe("shouldAutoTransition", () => {
  describe("guided mode", () => {
    it.each([...ACTIVE_PHASES])("returns autoTransition=false for active phase '%s'", (phase) => {
      const decision = shouldAutoTransition(phase, "guided");
      expect(decision.autoTransition).toBe(false);
      expect(decision.isHumanGate).toBe(true);
    });

    it.each(
      NON_ACTIVE_PHASES,
    )("returns autoTransition=false, isHumanGate=false for non-active phase '%s'", (phase) => {
      const decision = shouldAutoTransition(phase, "guided");
      expect(decision.autoTransition).toBe(false);
      expect(decision.isHumanGate).toBe(false);
    });
  });

  describe("plan-to-pr mode", () => {
    it.each(PLAN_TO_PR_GATES)("returns autoTransition=false for gate phase '%s'", (phase) => {
      const decision = shouldAutoTransition(phase, "plan-to-pr");
      expect(decision.autoTransition).toBe(false);
      expect(decision.isHumanGate).toBe(true);
    });

    const nonGateActivePhases = [...ACTIVE_PHASES].filter((p) => !PLAN_TO_PR_GATES.includes(p));

    it.each(
      nonGateActivePhases,
    )("returns autoTransition=true for non-gate active phase '%s'", (phase) => {
      const decision = shouldAutoTransition(phase, "plan-to-pr");
      expect(decision.autoTransition).toBe(true);
      expect(decision.isHumanGate).toBe(false);
    });

    it.each(
      NON_ACTIVE_PHASES,
    )("returns autoTransition=false, isHumanGate=false for non-active phase '%s'", (phase) => {
      const decision = shouldAutoTransition(phase, "plan-to-pr");
      expect(decision.autoTransition).toBe(false);
      expect(decision.isHumanGate).toBe(false);
    });
  });
});

describe("getHumanGates", () => {
  it("returns all active phases for guided mode", () => {
    const gates = getHumanGates("guided");
    expect(gates).toEqual(ACTIVE_PHASES);
  });

  it("returns exactly planning, reviewing, shipping for plan-to-pr mode", () => {
    const gates = getHumanGates("plan-to-pr");
    expect(gates).toEqual(new Set(["planning", "reviewing", "shipping"]));
  });
});

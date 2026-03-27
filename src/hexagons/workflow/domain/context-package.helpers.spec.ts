import { describe, expect, it } from "vitest";
import {
  buildTaskPrompt,
  isActivePhase,
  PHASE_AGENT_MAP,
  resolveAgentType,
} from "./context-package.helpers";
import { ACTIVE_PHASES } from "./transition-table";
import type { WorkflowPhase } from "./workflow-session.schemas";

describe("context-package helpers", () => {
  describe("isActivePhase", () => {
    it("returns true for all active phases", () => {
      for (const phase of ACTIVE_PHASES) {
        expect(isActivePhase(phase)).toBe(true);
      }
    });

    it("returns false for idle", () => {
      expect(isActivePhase("idle")).toBe(false);
    });

    it("returns false for paused", () => {
      expect(isActivePhase("paused")).toBe(false);
    });

    it("returns false for blocked", () => {
      expect(isActivePhase("blocked")).toBe(false);
    });

    it("returns false for completing-milestone", () => {
      expect(isActivePhase("completing-milestone")).toBe(false);
    });

    it("delegates to ACTIVE_PHASES from transition-table", () => {
      const allPhases: WorkflowPhase[] = [
        "idle",
        "discussing",
        "researching",
        "planning",
        "executing",
        "verifying",
        "reviewing",
        "shipping",
        "completing-milestone",
        "paused",
        "blocked",
      ];
      for (const phase of allPhases) {
        expect(isActivePhase(phase)).toBe(ACTIVE_PHASES.has(phase));
      }
    });
  });

  describe("resolveAgentType", () => {
    it("returns code-reviewer for reviewing", () => {
      expect(resolveAgentType("reviewing")).toBe("code-reviewer");
    });

    it("returns spec-reviewer for verifying", () => {
      expect(resolveAgentType("verifying")).toBe("spec-reviewer");
    });

    it("returns fixer for executing", () => {
      expect(resolveAgentType("executing")).toBe("fixer");
    });

    it("returns fixer for discussing", () => {
      expect(resolveAgentType("discussing")).toBe("fixer");
    });

    it("returns fixer for all phases not in PHASE_AGENT_MAP", () => {
      const phasesWithDefault: WorkflowPhase[] = [
        "idle",
        "discussing",
        "researching",
        "planning",
        "executing",
        "shipping",
        "completing-milestone",
        "paused",
        "blocked",
      ];
      for (const phase of phasesWithDefault) {
        expect(resolveAgentType(phase)).toBe("fixer");
      }
    });
  });

  describe("PHASE_AGENT_MAP", () => {
    it("only overrides reviewing and verifying", () => {
      expect(Object.keys(PHASE_AGENT_MAP)).toHaveLength(2);
      expect(PHASE_AGENT_MAP.reviewing).toBe("code-reviewer");
      expect(PHASE_AGENT_MAP.verifying).toBe("spec-reviewer");
    });
  });

  describe("buildTaskPrompt", () => {
    it("builds prompt with description and acceptance criteria", () => {
      const result = buildTaskPrompt("Do the thing", ["It works", "It passes"]);
      expect(result).toContain("Do the thing");
      expect(result).toContain("## Acceptance Criteria");
      expect(result).toContain("1. It works");
      expect(result).toContain("2. It passes");
    });

    it("builds prompt without AC section when criteria array is empty", () => {
      const result = buildTaskPrompt("Do the thing", []);
      expect(result).toBe("Do the thing");
      expect(result).not.toContain("Acceptance Criteria");
    });

    it("handles empty description", () => {
      const result = buildTaskPrompt("", ["Criterion"]);
      expect(result).toContain("## Acceptance Criteria");
      expect(result).toContain("1. Criterion");
    });

    it("handles empty description and empty criteria", () => {
      const result = buildTaskPrompt("", []);
      expect(result).toBe("");
    });
  });
});

import { describe, expect, it } from "vitest";
import { SKILL_NAMES } from "./context-package.schemas";
import { PHASE_SKILL_MAP, SKILL_REGISTRY, selectSkillsForPhase } from "./phase-skill-map";
import { ACTIVE_PHASES } from "./transition-table";

describe("PhaseSkillMap", () => {
  describe("SKILL_REGISTRY", () => {
    it("contains exactly 13 skills", () => {
      expect(Object.keys(SKILL_REGISTRY)).toHaveLength(13);
    });

    it("classifies all SKILL_NAMES values", () => {
      for (const name of Object.values(SKILL_NAMES)) {
        expect(SKILL_REGISTRY[name]).toBeDefined();
      }
    });

    it("classifies brainstorming as flexible", () => {
      expect(SKILL_REGISTRY.brainstorming).toBe("flexible");
    });

    it("classifies test-driven-development as rigid", () => {
      expect(SKILL_REGISTRY["test-driven-development"]).toBe("rigid");
    });

    it("classifies writing-plans as rigid", () => {
      expect(SKILL_REGISTRY["writing-plans"]).toBe("rigid");
    });
  });

  describe("PHASE_SKILL_MAP", () => {
    it("covers all 11 workflow phases", () => {
      expect(Object.keys(PHASE_SKILL_MAP)).toHaveLength(11);
    });

    it("maps non-active phases to empty arrays", () => {
      expect(PHASE_SKILL_MAP.idle).toEqual([]);
      expect(PHASE_SKILL_MAP.paused).toEqual([]);
      expect(PHASE_SKILL_MAP.blocked).toEqual([]);
      expect(PHASE_SKILL_MAP["completing-milestone"]).toEqual([]);
    });

    it("maps discussing to brainstorming", () => {
      expect(PHASE_SKILL_MAP.discussing).toEqual(["brainstorming"]);
    });

    it("maps executing to TDD + hexagonal + commit skills", () => {
      expect(PHASE_SKILL_MAP.executing).toEqual([
        "test-driven-development",
        "hexagonal-architecture",
        "commit-conventions",
      ]);
    });

    it("maps no phase to more than 3 skills", () => {
      for (const skills of Object.values(PHASE_SKILL_MAP)) {
        expect(skills.length).toBeLessThanOrEqual(3);
      }
    });
  });

  describe("selectSkillsForPhase", () => {
    it("returns empty array for idle", () => {
      expect(selectSkillsForPhase("idle")).toEqual([]);
    });

    it("returns skills sorted rigid-first for executing", () => {
      const skills = selectSkillsForPhase("executing");
      expect(skills).toHaveLength(3);
      expect(skills[0].type).toBe("rigid");
      expect(skills[0].name).toBe("test-driven-development");
      expect(skills[1].type).toBe("rigid");
      expect(skills[1].name).toBe("commit-conventions");
      expect(skills[2].type).toBe("flexible");
      expect(skills[2].name).toBe("hexagonal-architecture");
    });

    it("returns skills for every active phase", () => {
      for (const phase of ACTIVE_PHASES) {
        const skills = selectSkillsForPhase(phase);
        expect(skills.length).toBeGreaterThan(0);
      }
    });

    it("caps at 3 skills", () => {
      for (const phase of ACTIVE_PHASES) {
        expect(selectSkillsForPhase(phase).length).toBeLessThanOrEqual(3);
      }
    });

    it("returns SkillReference objects with name and type", () => {
      const skills = selectSkillsForPhase("planning");
      for (const skill of skills) {
        expect(skill).toHaveProperty("name");
        expect(skill).toHaveProperty("type");
      }
    });
  });
});

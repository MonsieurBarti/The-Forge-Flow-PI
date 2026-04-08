import { describe, expect, it } from "vitest";
import { type NextStepContext, NextStepSuggestion } from "./next-step-suggestion.vo";

describe("NextStepSuggestion", () => {
  const label = "M03-S08";

  describe("build() — guided mode", () => {
    const base: NextStepContext = {
      phase: "idle",
      autonomyMode: "guided",
      sliceLabel: label,
      allSlicesClosed: false,
    };

    it("idle (slices open) suggests /tff discuss", () => {
      const s = NextStepSuggestion.build(base);
      expect(s).not.toBeNull();
      expect(s?.command).toBe("/tff discuss");
      expect(s?.displayText).toBe("Next: /tff discuss");
      expect(s?.autoInvoke).toBe(false);
      expect(s?.args).toBeUndefined();
    });

    it("idle (all closed) suggests /tff complete-milestone", () => {
      const s = NextStepSuggestion.build({ ...base, allSlicesClosed: true });
      expect(s).not.toBeNull();
      expect(s?.command).toBe("/tff complete-milestone");
      expect(s?.displayText).toBe("Next: /tff complete-milestone");
      expect(s?.autoInvoke).toBe(false);
    });

    it("discussing suggests /tff research <label>", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "discussing" });
      expect(s?.command).toBe("/tff research");
      expect(s?.args).toBe(label);
      expect(s?.displayText).toBe(`Next: /tff research ${label}`);
      expect(s?.autoInvoke).toBe(false);
    });

    it("discussing + S-tier suggests /tff plan <label>", () => {
      const s = NextStepSuggestion.build({
        ...base,
        phase: "discussing",
        tier: "S",
      });
      expect(s?.command).toBe("/tff plan");
      expect(s?.args).toBe(label);
      expect(s?.displayText).toBe(`Next: /tff plan ${label}`);
    });

    it("discussing + tier undefined defaults to /tff research", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "discussing" });
      expect(s?.command).toBe("/tff research");
    });

    it("researching suggests /tff plan <label>", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "researching" });
      expect(s?.command).toBe("/tff plan");
      expect(s?.displayText).toBe(`Next: /tff plan ${label}`);
      expect(s?.autoInvoke).toBe(false);
    });

    it("planning shows awaiting approval", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "planning" });
      expect(s?.displayText).toBe("Awaiting plan approval");
      expect(s?.autoInvoke).toBe(false);
    });

    it("executing suggests /tff verify <label>", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "executing" });
      expect(s?.command).toBe("/tff verify");
      expect(s?.displayText).toBe(`Next: /tff verify ${label}`);
      expect(s?.autoInvoke).toBe(false);
    });

    it("verifying suggests /tff review <label>", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "verifying" });
      expect(s?.displayText).toBe(`Next: /tff review ${label}`);
      expect(s?.autoInvoke).toBe(false);
    });

    it("reviewing shows awaiting approval", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "reviewing" });
      expect(s?.displayText).toBe("Awaiting review approval");
      expect(s?.autoInvoke).toBe(false);
    });

    it("shipping shows awaiting approval", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "shipping" });
      expect(s?.displayText).toBe("Awaiting ship approval");
      expect(s?.autoInvoke).toBe(false);
    });

    it("completing-milestone returns null", () => {
      const s = NextStepSuggestion.build({
        ...base,
        phase: "completing-milestone",
      });
      expect(s).toBeNull();
    });

    it("paused includes previousPhase", () => {
      const s = NextStepSuggestion.build({
        ...base,
        phase: "paused",
        previousPhase: "executing",
      });
      expect(s?.command).toBe("/tff resume");
      expect(s?.displayText).toBe(`Resume: /tff resume ${label} (was: executing)`);
      expect(s?.autoInvoke).toBe(false);
    });

    it("blocked shows escalation message", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "blocked" });
      expect(s?.displayText).toBe("Blocked -- resolve escalation");
      expect(s?.autoInvoke).toBe(false);
    });

    it("autoInvoke is false for ALL guided phases", () => {
      const phases = [
        "idle",
        "discussing",
        "researching",
        "planning",
        "executing",
        "verifying",
        "reviewing",
        "shipping",
        "paused",
        "blocked",
      ] as const;
      for (const phase of phases) {
        const s = NextStepSuggestion.build({
          ...base,
          phase,
          previousPhase: phase === "paused" ? "executing" : undefined,
        });
        expect(s?.autoInvoke).toBe(false);
      }
    });
  });

  describe("build() — plan-to-pr mode", () => {
    const base: NextStepContext = {
      phase: "idle",
      autonomyMode: "plan-to-pr",
      sliceLabel: label,
      allSlicesClosed: false,
    };

    it("autoInvoke=true for active non-gate phases", () => {
      const autoInvokePhases = ["discussing", "researching", "executing", "verifying"] as const;
      for (const phase of autoInvokePhases) {
        const s = NextStepSuggestion.build({ ...base, phase });
        expect(s?.autoInvoke).toBe(true);
      }
    });

    it("autoInvoke=false for gate phases", () => {
      const gatePhases = ["planning", "reviewing", "shipping"] as const;
      for (const phase of gatePhases) {
        const s = NextStepSuggestion.build({ ...base, phase });
        expect(s?.autoInvoke).toBe(false);
      }
    });

    it("autoInvoke=false for idle, paused, blocked", () => {
      expect(NextStepSuggestion.build({ ...base, phase: "idle" })?.autoInvoke).toBe(false);
      expect(
        NextStepSuggestion.build({
          ...base,
          phase: "paused",
          previousPhase: "executing",
        })?.autoInvoke,
      ).toBe(false);
      expect(NextStepSuggestion.build({ ...base, phase: "blocked" })?.autoInvoke).toBe(false);
    });

    it("S-tier discussing still autoInvokes but targets /tff plan", () => {
      const s = NextStepSuggestion.build({
        ...base,
        phase: "discussing",
        tier: "S",
      });
      expect(s?.command).toBe("/tff plan");
      expect(s?.autoInvoke).toBe(true);
    });

    it("paused returns same suggestion regardless of mode", () => {
      const guided = NextStepSuggestion.build({
        phase: "paused",
        autonomyMode: "guided",
        sliceLabel: label,
        previousPhase: "executing",
        allSlicesClosed: false,
      });
      const p2pr = NextStepSuggestion.build({
        ...base,
        phase: "paused",
        previousPhase: "executing",
      });
      expect(guided?.displayText).toBe(p2pr?.displayText);
      expect(guided?.autoInvoke).toBe(p2pr?.autoInvoke);
    });

    it("blocked returns same suggestion regardless of mode", () => {
      const guided = NextStepSuggestion.build({
        phase: "blocked",
        autonomyMode: "guided",
        sliceLabel: label,
        allSlicesClosed: false,
      });
      const p2pr = NextStepSuggestion.build({ ...base, phase: "blocked" });
      expect(guided?.displayText).toBe(p2pr?.displayText);
    });
  });

  describe("displayText interpolation", () => {
    it("interpolates actual sliceLabel, not placeholder", () => {
      const s = NextStepSuggestion.build({
        phase: "researching",
        autonomyMode: "guided",
        sliceLabel: "M05-S12",
        allSlicesClosed: false,
      });
      expect(s?.displayText).toContain("M05-S12");
      expect(s?.displayText).not.toContain("<label>");
    });
  });
});

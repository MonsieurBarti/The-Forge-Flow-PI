import { describe, expect, it } from "vitest";
import {
  AUTO_LEARN_DEFAULTS,
  AUTONOMY_DEFAULTS,
  BEADS_DEFAULTS,
  MODEL_ROUTING_DEFAULTS,
  QUALITY_METRICS_DEFAULTS,
  SETTINGS_DEFAULTS,
  STACK_DEFAULTS,
  TOOL_POLICIES_DEFAULTS,
  WORKFLOW_DEFAULTS,
} from "./project-settings.schemas";
import { ProjectSettings } from "./project-settings.value-object";

describe("ProjectSettings", () => {
  describe("create", () => {
    it("creates instance with all defaults from empty object", () => {
      const settings = ProjectSettings.create({});
      expect(settings.modelRouting).toEqual(MODEL_ROUTING_DEFAULTS);
      expect(settings.autonomy).toEqual(AUTONOMY_DEFAULTS);
      expect(settings.autoLearn).toEqual(AUTO_LEARN_DEFAULTS);
      expect(settings.beads).toEqual(BEADS_DEFAULTS);
    });

    it("resolves quality profile model to opus", () => {
      const settings = ProjectSettings.create({});
      expect(settings.modelRouting.profiles.quality.model).toBe("opus");
    });

    it("falls back autonomy to defaults when corrupted, modelRouting unaffected", () => {
      const settings = ProjectSettings.create({ autonomy: "garbage" });
      expect(settings.autonomy).toEqual(AUTONOMY_DEFAULTS);
      expect(settings.modelRouting).toEqual(MODEL_ROUTING_DEFAULTS);
    });
  });

  describe("reconstitute", () => {
    it("creates instance from pre-validated props without re-validation", () => {
      const settings = ProjectSettings.reconstitute(SETTINGS_DEFAULTS);
      expect(settings.modelRouting).toEqual(MODEL_ROUTING_DEFAULTS);
      expect(settings.autonomy).toEqual(AUTONOMY_DEFAULTS);
    });
  });

  describe("getters", () => {
    it("returns correct modelRouting section", () => {
      const settings = ProjectSettings.create({});
      expect(settings.modelRouting.profiles.quality.model).toBe("opus");
      expect(settings.modelRouting.profiles.balanced.model).toBe("sonnet");
      expect(settings.modelRouting.profiles.budget.model).toBe("sonnet");
    });

    it("returns correct autonomy section", () => {
      const settings = ProjectSettings.create({});
      expect(settings.autonomy.mode).toBe("guided");
      expect(settings.autonomy.maxRetries).toBe(2);
    });

    it("returns correct autoLearn section", () => {
      const settings = ProjectSettings.create({});
      expect(settings.autoLearn.weights.frequency).toBe(0.25);
    });

    it("returns correct beads section", () => {
      const settings = ProjectSettings.create({});
      expect(settings.beads.timeout).toBe(30000);
    });

    it("returns correct toolPolicies section", () => {
      const settings = ProjectSettings.create({});
      expect(settings.toolPolicies).toEqual(TOOL_POLICIES_DEFAULTS);
    });

    it("returns correct workflow section", () => {
      const settings = ProjectSettings.create({});
      expect(settings.workflow).toEqual(WORKFLOW_DEFAULTS);
    });

    it("returns correct qualityMetrics section", () => {
      const settings = ProjectSettings.create({});
      expect(settings.qualityMetrics).toEqual(QUALITY_METRICS_DEFAULTS);
    });

    it("returns correct stack section", () => {
      const settings = ProjectSettings.create({});
      expect(settings.stack).toEqual(STACK_DEFAULTS);
    });
  });

  describe("toJSON", () => {
    it("returns full props snapshot", () => {
      const settings = ProjectSettings.create({});
      const json = settings.toJSON();
      expect(json).toEqual(SETTINGS_DEFAULTS);
    });
  });
});

import { ComplexityTierSchema } from "@kernel";
import { describe, expect, it } from "vitest";
import {
  AUTO_LEARN_DEFAULTS,
  AUTONOMY_DEFAULTS,
  BEADS_DEFAULTS,
  MODEL_ROUTING_DEFAULTS,
  ModelNameSchema,
  ModelProfileNameSchema,
  SettingsSchema,
} from "./project-settings.schemas";

describe("SettingsSchema", () => {
  it("produces fully-hydrated defaults from empty object", () => {
    const result = SettingsSchema.parse({});
    expect(result.modelRouting).toEqual(MODEL_ROUTING_DEFAULTS);
    expect(result.autonomy).toEqual(AUTONOMY_DEFAULTS);
    expect(result.autoLearn).toEqual(AUTO_LEARN_DEFAULTS);
    expect(result.beads).toEqual(BEADS_DEFAULTS);
  });

  it("recovers corrupted autonomy via .catch() without affecting modelRouting", () => {
    const result = SettingsSchema.parse({ autonomy: 123 });
    expect(result.autonomy).toEqual(AUTONOMY_DEFAULTS);
    expect(result.modelRouting).toEqual(MODEL_ROUTING_DEFAULTS);
  });

  it("recovers corrupted modelRouting via .catch() without affecting autonomy", () => {
    const result = SettingsSchema.parse({ modelRouting: "garbage" });
    expect(result.modelRouting).toEqual(MODEL_ROUTING_DEFAULTS);
    expect(result.autonomy).toEqual(AUTONOMY_DEFAULTS);
  });

  it("recovers corrupted autoLearn via .catch()", () => {
    const result = SettingsSchema.parse({ autoLearn: null });
    expect(result.autoLearn).toEqual(AUTO_LEARN_DEFAULTS);
  });

  it("recovers corrupted beads via .catch()", () => {
    const result = SettingsSchema.parse({ beads: [] });
    expect(result.beads).toEqual(BEADS_DEFAULTS);
  });

  it("preserves valid partial overrides", () => {
    const result = SettingsSchema.parse({
      autonomy: { mode: "plan-to-pr" },
    });
    expect(result.autonomy.mode).toBe("plan-to-pr");
    expect(result.autonomy.maxRetries).toBe(2);
  });
});

describe("ModelNameSchema", () => {
  it("accepts valid model names", () => {
    expect(ModelNameSchema.parse("opus")).toBe("opus");
    expect(ModelNameSchema.parse("sonnet")).toBe("sonnet");
    expect(ModelNameSchema.parse("haiku")).toBe("haiku");
  });

  it("rejects invalid model names", () => {
    expect(() => ModelNameSchema.parse("invalid")).toThrow();
  });
});

describe("ModelProfileNameSchema", () => {
  it("accepts valid profile names", () => {
    expect(ModelProfileNameSchema.parse("quality")).toBe("quality");
    expect(ModelProfileNameSchema.parse("balanced")).toBe("balanced");
    expect(ModelProfileNameSchema.parse("budget")).toBe("budget");
  });

  it("rejects invalid profile names", () => {
    expect(() => ModelProfileNameSchema.parse("invalid")).toThrow();
  });
});

describe("ComplexityTierSchema (from kernel)", () => {
  it("accepts valid tiers", () => {
    expect(ComplexityTierSchema.parse("S")).toBe("S");
    expect(ComplexityTierSchema.parse("F-lite")).toBe("F-lite");
    expect(ComplexityTierSchema.parse("F-full")).toBe("F-full");
  });
});

describe("default complexity mapping", () => {
  it("maps S to budget, F-lite to balanced, F-full to quality", () => {
    expect(MODEL_ROUTING_DEFAULTS.complexityMapping).toEqual({
      S: "budget",
      "F-lite": "balanced",
      "F-full": "quality",
    });
  });
});

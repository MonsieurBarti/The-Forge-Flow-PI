import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import {
  AUTONOMY_DEFAULTS,
  MODEL_ROUTING_DEFAULTS,
  type RawSettingsSources,
  SETTINGS_DEFAULTS,
} from "../domain/project-settings.schemas";
import { MergeSettingsUseCase } from "./merge-settings.use-case";

describe("MergeSettingsUseCase", () => {
  const useCase = new MergeSettingsUseCase();

  const emptySources: RawSettingsSources = { team: null, local: null, env: {} };

  it("returns all defaults when all sources are null/empty", () => {
    const result = useCase.execute(emptySources);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const json = result.data.toJSON();
      expect(json).toEqual(SETTINGS_DEFAULTS);
    }
  });

  it("team overrides autonomy.mode from defaults", () => {
    const sources: RawSettingsSources = {
      team: { autonomy: { mode: "plan-to-pr" } },
      local: null,
      env: {},
    };
    const result = useCase.execute(sources);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.autonomy.mode).toBe("plan-to-pr");
      expect(result.data.autonomy.maxRetries).toBe(2); // default preserved
    }
  });

  it("local overrides team for same key", () => {
    const sources: RawSettingsSources = {
      team: { autonomy: { mode: "guided" } },
      local: { autonomy: { mode: "plan-to-pr" } },
      env: {},
    };
    const result = useCase.execute(sources);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.autonomy.mode).toBe("plan-to-pr");
    }
  });

  it("env overrides both team and local", () => {
    const sources: RawSettingsSources = {
      team: { autonomy: { mode: "guided" } },
      local: { autonomy: { mode: "guided" } },
      env: { autonomy: { mode: "plan-to-pr" } },
    };
    const result = useCase.execute(sources);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.autonomy.mode).toBe("plan-to-pr");
    }
  });

  it("corrupted section falls back to defaults without affecting siblings", () => {
    const sources: RawSettingsSources = {
      team: { autonomy: 123 },
      local: null,
      env: {},
    };
    const result = useCase.execute(sources);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.autonomy).toEqual(AUTONOMY_DEFAULTS);
      expect(result.data.modelRouting).toEqual(MODEL_ROUTING_DEFAULTS);
    }
  });

  it("arrays are replaced, not concatenated", () => {
    const sources: RawSettingsSources = {
      team: {
        modelRouting: {
          profiles: { quality: { model: "opus", fallbackChain: ["sonnet"] } },
        },
      },
      local: {
        modelRouting: {
          profiles: { quality: { model: "opus", fallbackChain: ["haiku"] } },
        },
      },
      env: {},
    };
    const result = useCase.execute(sources);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.modelRouting.profiles.quality.fallbackChain).toEqual(["haiku"]);
    }
  });

  it("always returns a valid ProjectSettings (never errors)", () => {
    const sources: RawSettingsSources = {
      team: { everything: "garbage" },
      local: { more: "garbage" },
      env: { even: "more garbage" },
    };
    const result = useCase.execute(sources);
    expect(isOk(result)).toBe(true);
  });
});

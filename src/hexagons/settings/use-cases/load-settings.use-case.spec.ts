import { isOk } from "@kernel";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryEnvVarAdapter } from "../infrastructure/in-memory-env-var.adapter";
import { InMemorySettingsFileAdapter } from "../infrastructure/in-memory-settings-file.adapter";
import { LoadSettingsUseCase } from "./load-settings.use-case";

describe("LoadSettingsUseCase", () => {
  const fileAdapter = new InMemorySettingsFileAdapter();
  const envAdapter = new InMemoryEnvVarAdapter();
  const useCase = new LoadSettingsUseCase(fileAdapter, envAdapter);

  afterEach(() => {
    fileAdapter.reset();
    envAdapter.reset();
  });

  it("normalizes kebab-case keys to camelCase", async () => {
    fileAdapter.seed("/project/.tff/settings.yaml", "autonomy:\n  max-retries: 5");
    const result = await useCase.execute("/project");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const team = result.data.team;
      expect(team).not.toBeNull();
      if (team) {
        expect(team.autonomy).toEqual({ maxRetries: 5 });
      }
    }
  });

  it("reshapes model-profiles to modelRouting.profiles", async () => {
    fileAdapter.seed(
      "/project/.tff/settings.yaml",
      "model-profiles:\n  quality:\n    model: haiku",
    );
    const result = await useCase.execute("/project");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const team = result.data.team;
      expect(team).not.toBeNull();
      if (team) {
        expect(team).toHaveProperty("modelRouting.profiles", { quality: { model: "haiku" } });
        expect(team).not.toHaveProperty("modelProfiles");
      }
    }
  });

  it("returns null for missing settings file", async () => {
    const result = await useCase.execute("/project");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.team).toBeNull();
      expect(result.data.local).toBeNull();
    }
  });

  it("returns null for syntactically invalid YAML", async () => {
    fileAdapter.seed("/project/.tff/settings.yaml", "invalid: yaml: [: broken");
    const result = await useCase.execute("/project");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.team).toBeNull();
    }
  });

  it("maps TFF_AUTONOMY_MODE env var correctly", async () => {
    envAdapter.seed("TFF_AUTONOMY_MODE", "guided");
    const result = await useCase.execute("/project");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.env).toEqual({ autonomy: { mode: "guided" } });
    }
  });

  it("maps TFF_MODEL_QUALITY env var correctly", async () => {
    envAdapter.seed("TFF_MODEL_QUALITY", "haiku");
    const result = await useCase.execute("/project");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.env).toEqual({
        modelRouting: { profiles: { quality: { model: "haiku" } } },
      });
    }
  });

  it("parses numeric env vars as numbers", async () => {
    envAdapter.seed("TFF_AUTONOMY_MAX_RETRIES", "5");
    envAdapter.seed("TFF_BEADS_TIMEOUT", "60000");
    const result = await useCase.execute("/project");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.env).toHaveProperty("autonomy.maxRetries", 5);
      expect(result.data.env).toHaveProperty("beads.timeout", 60000);
    }
  });

  it("populates both team and local sources", async () => {
    fileAdapter.seed("/project/.tff/settings.yaml", "autonomy:\n  mode: guided");
    fileAdapter.seed("/project/.tff/settings.local.yaml", "autonomy:\n  mode: plan-to-pr");
    const result = await useCase.execute("/project");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.team).not.toBeNull();
      expect(result.data.local).not.toBeNull();
    }
  });
});

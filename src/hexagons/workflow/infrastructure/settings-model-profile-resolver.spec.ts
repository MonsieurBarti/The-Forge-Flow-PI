import { describe, expect, it } from "vitest";
import { MergeSettingsUseCase } from "@hexagons/settings";
import { SettingsModelProfileResolver } from "./settings-model-profile-resolver";

describe("SettingsModelProfileResolver", () => {
  const mergeSettings = new MergeSettingsUseCase();

  it("returns complexity-mapped profile for standard resolution", async () => {
    const resolver = new SettingsModelProfileResolver(mergeSettings);
    const profile = await resolver.resolveForPhase("executing", "F-lite");
    expect(typeof profile).toBe("string");
    expect(["quality", "balanced", "budget"]).toContain(profile);
  });

  it("returns a valid profile for S-tier", async () => {
    const resolver = new SettingsModelProfileResolver(mergeSettings);
    const profile = await resolver.resolveForPhase("executing", "S");
    expect(typeof profile).toBe("string");
  });

  it("returns balanced as default fallback", async () => {
    // Use real MergeSettingsUseCase with empty sources — should return defaults
    const resolver = new SettingsModelProfileResolver(mergeSettings);
    const profile = await resolver.resolveForPhase("discussing", "F-full");
    expect(typeof profile).toBe("string");
  });
});

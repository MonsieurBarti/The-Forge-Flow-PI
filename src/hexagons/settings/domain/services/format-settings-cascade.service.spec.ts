import { describe, expect, it } from "vitest";
import type { RawSettingsSources } from "../../use-cases/load-settings.use-case";
import { ProjectSettingsBuilder } from "../project-settings.builder";
import { FormatSettingsCascadeService } from "./format-settings-cascade.service";

function makeSources(overrides: Partial<RawSettingsSources> = {}): RawSettingsSources {
  return {
    team: null,
    local: null,
    env: {},
    ...overrides,
  };
}

describe("FormatSettingsCascadeService", () => {
  const service = new FormatSettingsCascadeService();

  it("attributes env source when env has the value", () => {
    const settings = new ProjectSettingsBuilder().build();
    const sources = makeSources({
      env: { autonomy: { mode: "plan-to-pr" } },
    });

    const result = service.format(settings, sources);

    expect(result).toContain("[env]");
    // The autonomy.mode row should have [env]
    const lines = result.split("\n");
    const modeLine = lines.find((l) => l.includes("autonomy.mode"));
    expect(modeLine).toBeDefined();
    expect(modeLine).toContain("[env]");
  });

  it("attributes local source when local has the value and env does not", () => {
    const settings = new ProjectSettingsBuilder().build();
    const sources = makeSources({
      local: { autonomy: { mode: "guided" } },
    });

    const result = service.format(settings, sources);

    const lines = result.split("\n");
    const modeLine = lines.find((l) => l.includes("autonomy.mode"));
    expect(modeLine).toBeDefined();
    expect(modeLine).toContain("[local]");
  });

  it("attributes team source when team has the value and env/local do not", () => {
    const settings = new ProjectSettingsBuilder().build();
    const sources = makeSources({
      team: { beads: { timeout: 60000 } },
    });

    const result = service.format(settings, sources);

    const lines = result.split("\n");
    const timeoutLine = lines.find((l) => l.includes("beads.timeout"));
    expect(timeoutLine).toBeDefined();
    expect(timeoutLine).toContain("[team]");
  });

  it("attributes default source when no source has the value", () => {
    const settings = new ProjectSettingsBuilder().build();
    const sources = makeSources();

    const result = service.format(settings, sources);

    // All values should be default
    expect(result).toContain("[default]");
    // No env/local/team labels should appear
    const lines = result.split("\n").filter((l) => l.startsWith("|") && l.includes("["));
    for (const line of lines) {
      expect(line).toContain("[default]");
    }
  });

  it("env takes precedence over local and team", () => {
    const settings = new ProjectSettingsBuilder().build();
    const sources = makeSources({
      env: { autonomy: { mode: "plan-to-pr" } },
      local: { autonomy: { mode: "guided" } },
      team: { autonomy: { mode: "guided" } },
    });

    const result = service.format(settings, sources);

    const lines = result.split("\n");
    const modeLine = lines.find((l) => l.includes("autonomy.mode"));
    expect(modeLine).toContain("[env]");
  });

  it("local takes precedence over team", () => {
    const settings = new ProjectSettingsBuilder().build();
    const sources = makeSources({
      local: { hotkeys: { dashboard: "ctrl+alt+d" } },
      team: { hotkeys: { dashboard: "ctrl+alt+d" } },
    });

    const result = service.format(settings, sources);

    const lines = result.split("\n");
    const dashLine = lines.find((l) => l.includes("hotkeys.dashboard"));
    expect(dashLine).toContain("[local]");
  });

  it("produces markdown headers for each section", () => {
    const settings = new ProjectSettingsBuilder().build();
    const sources = makeSources();

    const result = service.format(settings, sources);

    expect(result).toContain("# Settings — Active Configuration");
    expect(result).toContain("## autonomy");
    expect(result).toContain("## beads");
    expect(result).toContain("## hotkeys");
  });

  it("includes table headers for each section", () => {
    const settings = new ProjectSettingsBuilder().build();
    const sources = makeSources();

    const result = service.format(settings, sources);

    expect(result).toContain("| Setting | Value | Source |");
    expect(result).toContain("|---|---|---|");
  });
});

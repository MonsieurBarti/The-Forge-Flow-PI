import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createMockExtensionContext } from "@infrastructure/pi/testing";
import { err, ok } from "@kernel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { ProjectSettingsBuilder } from "../../../settings/domain/project-settings.builder";
import type { ReadSettingsToolDeps } from "./settings-read.tool";
import { createReadSettingsTool } from "./settings-read.tool";
import type { UpdateSettingToolDeps } from "./settings-update.tool";
import { createUpdateSettingTool } from "./settings-update.tool";

const mockCtx = createMockExtensionContext();

// ---------------------------------------------------------------------------
// tff_read_settings
// ---------------------------------------------------------------------------

function makeReadDeps(overrides: Partial<ReadSettingsToolDeps> = {}): ReadSettingsToolDeps {
  const settings = new ProjectSettingsBuilder().build();
  const sources = { team: null, local: null, env: {} };
  return {
    loadSettings: {
      execute: vi.fn().mockResolvedValue(ok(sources)),
    } as unknown as ReadSettingsToolDeps["loadSettings"],
    mergeSettings: {
      execute: vi.fn().mockReturnValue(ok(settings)),
    } as unknown as ReadSettingsToolDeps["mergeSettings"],
    formatCascade: {
      format: vi.fn().mockReturnValue("# Settings — Active Configuration\n"),
    } as unknown as ReadSettingsToolDeps["formatCascade"],
    projectRoot: "/tmp/project",
    ...overrides,
  };
}

describe("tff_read_settings tool", () => {
  it("has correct name", () => {
    const tool = createReadSettingsTool(makeReadDeps());
    expect(tool.name).toBe("tff_read_settings");
  });

  it("returns JSON of merged settings on success", async () => {
    const deps = makeReadDeps();
    const tool = createReadSettingsTool(deps);

    const result = await tool.execute("call-1", {}, undefined, undefined, mockCtx);

    const block = result.content[0];
    const text = block.type === "text" ? block.text : "";
    const parsed = JSON.parse(text);

    // Should be valid JSON with settings keys
    expect(parsed).toHaveProperty("autonomy");
    expect(parsed).toHaveProperty("beads");
  });

  it("returns error text when loadSettings fails", async () => {
    const deps = makeReadDeps({
      loadSettings: {
        execute: vi.fn().mockResolvedValue(err(new Error("file not found"))),
      } as unknown as ReadSettingsToolDeps["loadSettings"],
    });
    const tool = createReadSettingsTool(deps);

    const result = await tool.execute("call-2", {}, undefined, undefined, mockCtx);

    const block = result.content[0];
    const text = block.type === "text" ? block.text : "";
    expect(text).toContain("Error: file not found");
  });

  it("returns error text when mergeSettings fails", async () => {
    const sources = { team: null, local: null, env: {} };
    const deps = makeReadDeps({
      loadSettings: {
        execute: vi.fn().mockResolvedValue(ok(sources)),
      } as unknown as ReadSettingsToolDeps["loadSettings"],
      mergeSettings: {
        execute: vi.fn().mockReturnValue(err(new Error("merge conflict"))),
      } as unknown as ReadSettingsToolDeps["mergeSettings"],
    });
    const tool = createReadSettingsTool(deps);

    const result = await tool.execute("call-3", {}, undefined, undefined, mockCtx);

    const block = result.content[0];
    const text = block.type === "text" ? block.text : "";
    expect(text).toContain("Error: merge failed");
  });
});

// ---------------------------------------------------------------------------
// tff_update_setting
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeUpdateDeps(overrides: Partial<UpdateSettingToolDeps> = {}): UpdateSettingToolDeps {
  return {
    projectRoot: tmpDir,
    ...overrides,
  };
}

describe("tff_update_setting tool", () => {
  beforeEach(() => {
    tmpDir = join("/tmp", `tff-settings-test-${Date.now()}`);
    mkdirSync(join(tmpDir, ".tff"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has correct name", () => {
    const tool = createUpdateSettingTool(makeUpdateDeps());
    expect(tool.name).toBe("tff_update_setting");
  });

  it("writes a new setting to settings.yaml", async () => {
    const deps = makeUpdateDeps();
    const tool = createUpdateSettingTool(deps);

    const result = await tool.execute(
      "call-1",
      { key: "autonomy.mode", value: "plan-to-pr" },
      undefined,
      undefined,
      mockCtx,
    );

    const block = result.content[0];
    const text = block.type === "text" ? block.text : "";
    const parsed = JSON.parse(text);
    expect(parsed.updated).toBe("autonomy.mode");
    expect(parsed.value).toBe("plan-to-pr");

    const settingsPath = join(tmpDir, ".tff", "settings.yaml");
    const written = parseYaml(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    expect((written.autonomy as Record<string, unknown>).mode).toBe("plan-to-pr");
  });

  it("merges into existing settings without overwriting other keys", async () => {
    const deps = makeUpdateDeps();
    const tool = createUpdateSettingTool(deps);

    // Write initial key
    await tool.execute(
      "call-1",
      { key: "beads.timeout", value: 60000 },
      undefined,
      undefined,
      mockCtx,
    );

    // Write second key
    await tool.execute(
      "call-2",
      { key: "autonomy.mode", value: "guided" },
      undefined,
      undefined,
      mockCtx,
    );

    const settingsPath = join(tmpDir, ".tff", "settings.yaml");
    const written = parseYaml(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    expect((written.beads as Record<string, unknown>).timeout).toBe(60000);
    expect((written.autonomy as Record<string, unknown>).mode).toBe("guided");
  });

  it("creates settings.yaml when file does not exist", async () => {
    const deps = makeUpdateDeps();
    const tool = createUpdateSettingTool(deps);

    await tool.execute(
      "call-1",
      { key: "hotkeys.dashboard", value: "ctrl+shift+d" },
      undefined,
      undefined,
      mockCtx,
    );

    const settingsPath = join(tmpDir, ".tff", "settings.yaml");
    const written = parseYaml(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    expect((written.hotkeys as Record<string, unknown>).dashboard).toBe("ctrl+shift+d");
  });

  it("supports deeply nested dot-path keys", async () => {
    const deps = makeUpdateDeps();
    const tool = createUpdateSettingTool(deps);

    await tool.execute(
      "call-1",
      { key: "modelRouting.profiles.quality.model", value: "claude-opus-4" },
      undefined,
      undefined,
      mockCtx,
    );

    const settingsPath = join(tmpDir, ".tff", "settings.yaml");
    const written = parseYaml(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    const profiles = (written.modelRouting as Record<string, unknown>).profiles as Record<
      string,
      unknown
    >;
    expect((profiles.quality as Record<string, unknown>).model).toBe("claude-opus-4");
  });
});

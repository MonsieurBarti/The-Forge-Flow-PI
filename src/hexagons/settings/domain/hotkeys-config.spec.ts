import { describe, expect, it } from "vitest";
import {
  HotkeysConfigSchema,
  HOTKEYS_DEFAULTS,
  SettingsSchema,
  ENV_VAR_MAP,
} from "./project-settings.schemas";

describe("HotkeysConfigSchema", () => {
  it("produces correct defaults from empty object", () => {
    const result = HotkeysConfigSchema.parse({});
    expect(result).toEqual({
      dashboard: "ctrl+alt+d",
      workflow: "ctrl+alt+w",
      executionMonitor: "ctrl+alt+e",
    });
  });

  it("HOTKEYS_DEFAULTS matches schema defaults", () => {
    expect(HOTKEYS_DEFAULTS).toEqual({
      dashboard: "ctrl+alt+d",
      workflow: "ctrl+alt+w",
      executionMonitor: "ctrl+alt+e",
    });
  });

  it("accepts custom hotkey values", () => {
    const result = HotkeysConfigSchema.parse({
      dashboard: "ctrl+d",
      workflow: "ctrl+w",
      executionMonitor: "ctrl+e",
    });
    expect(result.dashboard).toBe("ctrl+d");
    expect(result.workflow).toBe("ctrl+w");
    expect(result.executionMonitor).toBe("ctrl+e");
  });

  it("is included in SettingsSchema with defaults", () => {
    const settings = SettingsSchema.parse({});
    expect(settings.hotkeys).toEqual(HOTKEYS_DEFAULTS);
  });

  it("recovers corrupted hotkeys via .catch()", () => {
    const settings = SettingsSchema.parse({ hotkeys: 42 });
    expect(settings.hotkeys).toEqual(HOTKEYS_DEFAULTS);
  });

  it("env var mappings include hotkey entries", () => {
    expect(ENV_VAR_MAP.TFF_HOTKEY_DASHBOARD).toEqual(["hotkeys", "dashboard"]);
    expect(ENV_VAR_MAP.TFF_HOTKEY_WORKFLOW).toEqual(["hotkeys", "workflow"]);
    expect(ENV_VAR_MAP.TFF_HOTKEY_EXECUTION_MONITOR).toEqual([
      "hotkeys",
      "executionMonitor",
    ]);
  });
});

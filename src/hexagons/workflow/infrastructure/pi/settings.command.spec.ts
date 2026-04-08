import { createMockExtensionAPI } from "@infrastructure/pi/testing";
import { err, ok } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import { TffDispatcher } from "../../../../cli/tff-dispatcher";
import { ProjectSettingsBuilder } from "../../../settings/domain/project-settings.builder";
import type { SettingsCommandDeps } from "./settings.command";
import { registerSettingsCommand } from "./settings.command";

function makeSettings() {
  return new ProjectSettingsBuilder().build();
}

function makeDeps(overrides: Partial<SettingsCommandDeps> = {}): SettingsCommandDeps {
  const settings = makeSettings();
  const sources = { team: null, local: null, env: {} };
  return {
    loadSettings: {
      execute: vi.fn().mockResolvedValue(ok(sources)),
    } as unknown as SettingsCommandDeps["loadSettings"],
    mergeSettings: {
      execute: vi.fn().mockReturnValue(ok(settings)),
    } as unknown as SettingsCommandDeps["mergeSettings"],
    formatCascade: {
      format: vi.fn().mockReturnValue("# Settings — Active Configuration\n"),
    } as unknown as SettingsCommandDeps["formatCascade"],
    projectRoot: "/tmp/project",
    ...overrides,
  };
}

async function invokeHandler(deps: SettingsCommandDeps) {
  const { api, fns } = createMockExtensionAPI();
  const dispatcher = new TffDispatcher();
  registerSettingsCommand(dispatcher, api, deps);
  // biome-ignore lint/style/noNonNullAssertion: test helper — command is always registered
  const handler = dispatcher.getSubcommands().find((s) => s.name === "settings")!.handler;
  await handler("", undefined as never);
  return { fns };
}

describe("registerSettingsCommand", () => {
  it("registers settings subcommand", () => {
    const { api } = createMockExtensionAPI();
    const dispatcher = new TffDispatcher();
    registerSettingsCommand(dispatcher, api, makeDeps());
    expect(dispatcher.getSubcommands().find((s) => s.name === "settings")).toBeDefined();
  });

  it("loads, merges, formats, and sends cascade on success", async () => {
    const deps = makeDeps();
    const { fns } = await invokeHandler(deps);

    expect(deps.loadSettings.execute).toHaveBeenCalledWith("/tmp/project");
    expect(deps.mergeSettings.execute).toHaveBeenCalled();
    expect(deps.formatCascade.format).toHaveBeenCalled();
    expect(fns.sendUserMessage).toHaveBeenCalledWith("# Settings — Active Configuration\n");
  });

  it("sends error message when loadSettings fails", async () => {
    const deps = makeDeps({
      loadSettings: {
        execute: vi.fn().mockResolvedValue(err(new Error("file read failed"))),
      } as unknown as SettingsCommandDeps["loadSettings"],
    });

    const { fns } = await invokeHandler(deps);

    expect(fns.sendUserMessage).toHaveBeenCalledWith("Error: file read failed");
    expect(deps.mergeSettings.execute).not.toHaveBeenCalled();
  });

  it("silently returns when mergeSettings fails", async () => {
    const deps = makeDeps({
      mergeSettings: {
        execute: vi.fn().mockReturnValue({ ok: false, error: new Error("merge failed") }),
      } as unknown as SettingsCommandDeps["mergeSettings"],
    });

    await invokeHandler(deps);

    expect(deps.formatCascade.format).not.toHaveBeenCalled();
  });
});

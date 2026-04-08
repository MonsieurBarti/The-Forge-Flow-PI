import { MergeSettingsUseCase } from "@hexagons/settings";
import { createMockExtensionAPI } from "@infrastructure/pi/testing";
import { DateProviderPort, InProcessEventBus, SilentLoggerAdapter } from "@kernel";
import { describe, expect, it } from "vitest";
import { TffDispatcher } from "../../../../cli/tff-dispatcher";
import { InMemoryProjectRepository } from "../in-memory-project.repository";
import { InMemoryProjectFileSystemAdapter } from "../in-memory-project-filesystem.adapter";
import { registerProjectExtension } from "./project.extension";

class StubDateProvider extends DateProviderPort {
  now(): Date {
    return new Date("2026-01-15T12:00:00Z");
  }
}

describe("registerProjectExtension", () => {
  it("registers new subcommand", () => {
    const { api } = createMockExtensionAPI();
    const dispatcher = new TffDispatcher();
    registerProjectExtension(dispatcher, api, {
      projectRoot: "/workspace",
      projectRepo: new InMemoryProjectRepository(),
      projectFs: new InMemoryProjectFileSystemAdapter(),
      mergeSettings: new MergeSettingsUseCase(),
      eventBus: new InProcessEventBus(new SilentLoggerAdapter()),
      dateProvider: new StubDateProvider(),
      loadPrompt: () => "stub prompt",
    });
    expect(dispatcher.getSubcommands().find((s) => s.name === "new")).toBeDefined();
  });

  it("registers tff_init_project tool", () => {
    const { api, fns } = createMockExtensionAPI();
    const dispatcher = new TffDispatcher();
    registerProjectExtension(dispatcher, api, {
      projectRoot: "/workspace",
      projectRepo: new InMemoryProjectRepository(),
      projectFs: new InMemoryProjectFileSystemAdapter(),
      mergeSettings: new MergeSettingsUseCase(),
      eventBus: new InProcessEventBus(new SilentLoggerAdapter()),
      dateProvider: new StubDateProvider(),
      loadPrompt: () => "stub prompt",
    });
    expect(fns.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tff_init_project" }),
    );
  });
});

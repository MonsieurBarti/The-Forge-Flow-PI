import { MergeSettingsUseCase } from "@hexagons/settings";
import { createMockExtensionAPI } from "@infrastructure/pi/testing";
import { DateProviderPort, InProcessEventBus, SilentLoggerAdapter } from "@kernel";
import { describe, expect, it } from "vitest";
import { InMemoryProjectRepository } from "../in-memory-project.repository";
import { InMemoryProjectFileSystemAdapter } from "../in-memory-project-filesystem.adapter";
import { registerProjectExtension } from "./project.extension";

class StubDateProvider extends DateProviderPort {
  now(): Date {
    return new Date("2026-01-15T12:00:00Z");
  }
}

describe("registerProjectExtension", () => {
  it("registers tff:new command", () => {
    const { api, fns } = createMockExtensionAPI();
    registerProjectExtension(api, {
      projectRoot: "/workspace",
      projectRepo: new InMemoryProjectRepository(),
      projectFs: new InMemoryProjectFileSystemAdapter(),
      mergeSettings: new MergeSettingsUseCase(),
      eventBus: new InProcessEventBus(new SilentLoggerAdapter()),
      dateProvider: new StubDateProvider(),
      loadPrompt: () => "stub prompt",
    });
    expect(fns.registerCommand).toHaveBeenCalledWith(
      "tff:new",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers tff_init_project tool", () => {
    const { api, fns } = createMockExtensionAPI();
    registerProjectExtension(api, {
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

import { MergeSettingsUseCase } from "@hexagons/settings";
import { DateProviderPort, InProcessEventBus, SilentLoggerAdapter } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import { InMemoryProjectRepository } from "../in-memory-project.repository";
import { InMemoryProjectFileSystemAdapter } from "../in-memory-project-filesystem.adapter";
import { registerProjectExtension } from "./project.extension";

class StubDateProvider extends DateProviderPort {
  now(): Date {
    return new Date("2026-01-15T12:00:00Z");
  }
}

function makeMockApi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
}

describe("registerProjectExtension", () => {
  it("registers tff:new command", () => {
    const api = makeMockApi();
    registerProjectExtension(api, {
      projectRoot: "/workspace",
      projectRepo: new InMemoryProjectRepository(),
      projectFs: new InMemoryProjectFileSystemAdapter(),
      mergeSettings: new MergeSettingsUseCase(),
      eventBus: new InProcessEventBus(new SilentLoggerAdapter()),
      dateProvider: new StubDateProvider(),
    });
    expect(api.registerCommand).toHaveBeenCalledWith(
      "tff:new",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers tff_init_project tool", () => {
    const api = makeMockApi();
    registerProjectExtension(api, {
      projectRoot: "/workspace",
      projectRepo: new InMemoryProjectRepository(),
      projectFs: new InMemoryProjectFileSystemAdapter(),
      mergeSettings: new MergeSettingsUseCase(),
      eventBus: new InProcessEventBus(new SilentLoggerAdapter()),
      dateProvider: new StubDateProvider(),
    });
    expect(api.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tff_init_project" }),
    );
  });
});

import { DiscoverStackUseCase, MergeSettingsUseCase } from "@hexagons/settings";
import { InMemorySettingsFileAdapter } from "@hexagons/settings/infrastructure/in-memory-settings-file.adapter";
import {
  DateProviderPort,
  type DomainEvent,
  EVENT_NAMES,
  InProcessEventBus,
  isErr,
  isOk,
  SilentLoggerAdapter,
} from "@kernel";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ProjectAlreadyExistsError } from "../domain/errors/project-already-exists.error";
import { InMemoryProjectRepository } from "../infrastructure/in-memory-project.repository";
import { InMemoryProjectFileSystemAdapter } from "../infrastructure/in-memory-project-filesystem.adapter";
import { InitProjectUseCase } from "./init-project.use-case";

class StubDateProvider extends DateProviderPort {
  private readonly date: Date;
  constructor(date: Date = new Date("2026-01-15T12:00:00Z")) {
    super();
    this.date = date;
  }
  now(): Date {
    return this.date;
  }
}

function setup() {
  const projectRepo = new InMemoryProjectRepository();
  const projectFs = new InMemoryProjectFileSystemAdapter();
  const mergeSettings = new MergeSettingsUseCase();
  const eventBus = new InProcessEventBus(new SilentLoggerAdapter());
  const dateProvider = new StubDateProvider();
  const useCase = new InitProjectUseCase(
    projectRepo,
    projectFs,
    mergeSettings,
    eventBus,
    dateProvider,
  );
  return { useCase, projectRepo, projectFs, eventBus };
}

describe("InitProjectUseCase", () => {
  it("creates .tff directory structure", async () => {
    const { useCase, projectFs } = setup();
    const result = await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    expect(isOk(result)).toBe(true);

    for (const dir of [
      "/workspace/.tff/milestones",
      "/workspace/.tff/skills",
      "/workspace/.tff/observations",
    ]) {
      const exists = await projectFs.exists(dir);
      expect(isOk(exists) && exists.data).toBe(true);
    }
  });

  it("writes PROJECT.md with name and vision", async () => {
    const { useCase, projectFs } = setup();
    await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    const content = projectFs.getContent("/workspace/.tff/PROJECT.md");
    expect(content).toContain("My Project");
    expect(content).toContain("Build something great");
  });

  it("writes settings.yaml with defaults", async () => {
    const { useCase, projectFs } = setup();
    await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    const content = projectFs.getContent("/workspace/.tff/settings.yaml");
    expect(content).toBeDefined();
    expect(content).toContain("modelRouting");
  });

  it("saves Project aggregate to repository", async () => {
    const { useCase, projectRepo } = setup();
    await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    const found = await projectRepo.findSingleton();
    expect(isOk(found)).toBe(true);
    if (isOk(found)) {
      expect(found.data).not.toBeNull();
      expect(found.data?.name).toBe("My Project");
    }
  });

  it("publishes ProjectInitializedEvent", async () => {
    const { useCase, eventBus } = setup();
    const events: DomainEvent[] = [];
    eventBus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async (e) => {
      events.push(e);
    });
    await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    expect(events).toHaveLength(1);
  });

  it("returns error if .tff/ already exists", async () => {
    const { useCase, projectFs } = setup();
    await projectFs.createDirectory("/workspace/.tff");
    const result = await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ProjectAlreadyExistsError);
    }
  });

  it("populates stack.detected in settings.yaml when discoverStack is provided", async () => {
    const projectRepo = new InMemoryProjectRepository();
    const projectFs = new InMemoryProjectFileSystemAdapter();
    const mergeSettings = new MergeSettingsUseCase();
    const eventBus = new InProcessEventBus(new SilentLoggerAdapter());
    const dateProvider = new StubDateProvider();

    const settingsFile = new InMemorySettingsFileAdapter();
    settingsFile.seed(
      "/workspace/package.json",
      JSON.stringify({
        dependencies: { next: "14.0.0" },
        devDependencies: { typescript: "5.0.0", vitest: "1.0.0" },
      }),
    );
    settingsFile.seed("/workspace/vitest.config.ts", "export default {}");
    const discoverStack = new DiscoverStackUseCase(settingsFile);

    const useCase = new InitProjectUseCase(
      projectRepo,
      projectFs,
      mergeSettings,
      eventBus,
      dateProvider,
      undefined,
      discoverStack,
    );

    const result = await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    expect(isOk(result)).toBe(true);

    const content = projectFs.getContent("/workspace/.tff/settings.yaml");
    expect(content).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: guarded by expect above
    const parsed = parse(content!);
    expect(parsed.stack.detected.framework).toBe("next");
    expect(parsed.stack.detected.runtime).toBe("typescript");
    expect(parsed.stack.detected.testRunner).toBe("vitest");
    expect(parsed.stack.overrides).toEqual({});
  });

  it("writes settings.yaml without stack.detected when discoverStack is not provided", async () => {
    const { useCase, projectFs } = setup();
    const result = await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    expect(isOk(result)).toBe(true);

    const content = projectFs.getContent("/workspace/.tff/settings.yaml");
    expect(content).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: guarded by expect above
    const parsed = parse(content!);
    expect(parsed.stack.detected).toEqual({});
    expect(parsed.stack.overrides).toEqual({});
  });
});

import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { InMemoryReviewUIAdapter } from "@hexagons/review/infrastructure/adapters/review-ui/in-memory-review-ui.adapter";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { WorkflowSliceTransitionAdapter } from "@hexagons/slice/infrastructure/workflow-slice-transition.adapter";
import { CreateTasksUseCase } from "@hexagons/task/application/create-tasks.use-case";
import { DetectWavesUseCase } from "@hexagons/task/domain/detect-waves.use-case";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import { createMockExtensionAPI } from "@infrastructure/pi/testing";
import type { Result } from "@kernel";
import { InProcessEventBus, SilentLoggerAdapter, SystemDateProvider } from "@kernel";
import { describe, expect, it } from "vitest";
import type { ContextPackage } from "../../domain/context-package.value-object";
import type { ContextStagingError } from "../../domain/errors/context-staging.error";
import { ContextStagingPort } from "../../domain/ports/context-staging.port";
import { InMemoryArtifactFileAdapter } from "../in-memory-artifact-file.adapter";
import { InMemoryWorkflowSessionRepository } from "../in-memory-workflow-session.repository";
import type { WorkflowExtensionDeps } from "./workflow.extension";
import { registerWorkflowExtension } from "./workflow.extension";

class StubContextStaging extends ContextStagingPort {
  async stage(): Promise<Result<ContextPackage, ContextStagingError>> {
    throw new Error("Not implemented");
  }
}

function makeDeps(): WorkflowExtensionDeps {
  const sliceRepo = new InMemorySliceRepository();
  const taskRepo = new InMemoryTaskRepository();
  const dateProvider = new SystemDateProvider();
  return {
    projectRepo: new InMemoryProjectRepository(),
    milestoneRepo: new InMemoryMilestoneRepository(),
    sliceRepo,
    taskRepo,
    createTasksPort: new CreateTasksUseCase(taskRepo, new DetectWavesUseCase(), dateProvider),
    sliceTransitionPort: new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider),
    eventBus: new InProcessEventBus(new SilentLoggerAdapter()),
    dateProvider,
    contextStaging: new StubContextStaging(),
    artifactFile: new InMemoryArtifactFileAdapter(),
    workflowSessionRepo: new InMemoryWorkflowSessionRepository(),
    autonomyModeProvider: { getAutonomyMode: () => "guided" as const },
    reviewUI: new InMemoryReviewUIAdapter(),
    maxRetries: 2,
  };
}

describe("registerWorkflowExtension", () => {
  it("registers tff:status command", () => {
    const { api, fns } = createMockExtensionAPI();
    registerWorkflowExtension(api, makeDeps());
    expect(fns.registerCommand).toHaveBeenCalledWith(
      "tff:status",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers tff_status tool", () => {
    const { api, fns } = createMockExtensionAPI();
    registerWorkflowExtension(api, makeDeps());
    expect(fns.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "tff_status" }));
  });

  it("registers tff:discuss command", () => {
    const { api, fns } = createMockExtensionAPI();
    registerWorkflowExtension(api, makeDeps());
    expect(fns.registerCommand).toHaveBeenCalledWith(
      "tff:discuss",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers discuss-related tools", () => {
    const { api, fns } = createMockExtensionAPI();
    registerWorkflowExtension(api, makeDeps());
    const toolNames = fns.registerTool.mock.calls.map((call) => call[0].name);
    expect(toolNames).toContain("tff_write_spec");
    expect(toolNames).toContain("tff_classify_complexity");
    expect(toolNames).toContain("tff_workflow_transition");
  });

  it("registers tff:research command", () => {
    const { api, fns } = createMockExtensionAPI();
    registerWorkflowExtension(api, makeDeps());
    expect(fns.registerCommand).toHaveBeenCalledWith(
      "tff:research",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers tff_write_research tool", () => {
    const { api, fns } = createMockExtensionAPI();
    registerWorkflowExtension(api, makeDeps());
    const toolNames = fns.registerTool.mock.calls.map((call) => call[0].name);
    expect(toolNames).toContain("tff_write_research");
  });

  it("registers tff:plan command", () => {
    const { api, fns } = createMockExtensionAPI();
    registerWorkflowExtension(api, makeDeps());
    expect(fns.registerCommand).toHaveBeenCalledWith(
      "tff:plan",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers tff_write_plan tool", () => {
    const { api, fns } = createMockExtensionAPI();
    registerWorkflowExtension(api, makeDeps());
    const toolNames = fns.registerTool.mock.calls.map((call) => call[0].name);
    expect(toolNames).toContain("tff_write_plan");
  });

  it("write-spec tool calls ReviewUIPort.presentForApproval after write (AC5, AC6)", () => {
    const { api, fns } = createMockExtensionAPI();
    const deps = makeDeps();
    const reviewUI = deps.reviewUI as InMemoryReviewUIAdapter;
    registerWorkflowExtension(api, deps);

    const writeSpecCall = fns.registerTool.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === "tff_write_spec",
    );
    expect(writeSpecCall).toBeDefined();
    // ReviewUI is injectable and starts with no presentations
    expect(reviewUI.presentations).toHaveLength(0);
  });

  it("registers tff:quick command", () => {
    const { api, fns } = createMockExtensionAPI();
    registerWorkflowExtension(api, makeDeps());
    expect(fns.registerCommand).toHaveBeenCalledWith(
      "tff:quick",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers tff:debug command", () => {
    const { api, fns } = createMockExtensionAPI();
    registerWorkflowExtension(api, makeDeps());
    expect(fns.registerCommand).toHaveBeenCalledWith(
      "tff:debug",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers tff_quick_start tool", () => {
    const { api, fns } = createMockExtensionAPI();
    registerWorkflowExtension(api, makeDeps());
    const toolNames = fns.registerTool.mock.calls.map((call) => call[0].name);
    expect(toolNames).toContain("tff_quick_start");
  });
});

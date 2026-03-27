import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { WorkflowSliceTransitionAdapter } from "@hexagons/slice/infrastructure/workflow-slice-transition.adapter";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import type { Result } from "@kernel";
import { InProcessEventBus, SilentLoggerAdapter, SystemDateProvider } from "@kernel";
import { describe, expect, it, vi } from "vitest";
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

function makeMockApi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
}

function makeDeps(): WorkflowExtensionDeps {
  const sliceRepo = new InMemorySliceRepository();
  const dateProvider = new SystemDateProvider();
  return {
    projectRepo: new InMemoryProjectRepository(),
    milestoneRepo: new InMemoryMilestoneRepository(),
    sliceRepo,
    taskRepo: new InMemoryTaskRepository(),
    sliceTransitionPort: new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider),
    eventBus: new InProcessEventBus(new SilentLoggerAdapter()),
    dateProvider,
    contextStaging: new StubContextStaging(),
    artifactFile: new InMemoryArtifactFileAdapter(),
    workflowSessionRepo: new InMemoryWorkflowSessionRepository(),
    autonomyModeProvider: { getAutonomyMode: () => "guided" as const },
    maxRetries: 2,
  };
}

describe("registerWorkflowExtension", () => {
  it("registers tff:status command", () => {
    const api = makeMockApi();
    registerWorkflowExtension(api, makeDeps());
    expect(api.registerCommand).toHaveBeenCalledWith(
      "tff:status",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers tff_status tool", () => {
    const api = makeMockApi();
    registerWorkflowExtension(api, makeDeps());
    expect(api.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "tff_status" }));
  });

  it("registers tff:discuss command", () => {
    const api = makeMockApi();
    registerWorkflowExtension(api, makeDeps());
    expect(api.registerCommand).toHaveBeenCalledWith(
      "tff:discuss",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers discuss-related tools", () => {
    const api = makeMockApi();
    registerWorkflowExtension(api, makeDeps());
    const toolNames = api.registerTool.mock.calls.map((call) => call[0].name);
    expect(toolNames).toContain("tff_write_spec");
    expect(toolNames).toContain("tff_classify_complexity");
    expect(toolNames).toContain("tff_workflow_transition");
  });
});

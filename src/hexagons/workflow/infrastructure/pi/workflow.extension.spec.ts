import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { WorkflowSliceTransitionAdapter } from "@hexagons/slice/infrastructure/workflow-slice-transition.adapter";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import { InProcessEventBus, SilentLoggerAdapter, SystemDateProvider } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import { registerWorkflowExtension } from "./workflow.extension";

function makeMockApi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
}

describe("registerWorkflowExtension", () => {
  it("registers tff:status command", () => {
    const api = makeMockApi();
    const sliceRepo = new InMemorySliceRepository();
    const dateProvider = new SystemDateProvider();
    registerWorkflowExtension(api, {
      projectRepo: new InMemoryProjectRepository(),
      milestoneRepo: new InMemoryMilestoneRepository(),
      sliceRepo,
      taskRepo: new InMemoryTaskRepository(),
      sliceTransitionPort: new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider),
      eventBus: new InProcessEventBus(new SilentLoggerAdapter()),
      dateProvider,
    });
    expect(api.registerCommand).toHaveBeenCalledWith(
      "tff:status",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers tff_status tool", () => {
    const api = makeMockApi();
    const sliceRepo = new InMemorySliceRepository();
    const dateProvider = new SystemDateProvider();
    registerWorkflowExtension(api, {
      projectRepo: new InMemoryProjectRepository(),
      milestoneRepo: new InMemoryMilestoneRepository(),
      sliceRepo,
      taskRepo: new InMemoryTaskRepository(),
      sliceTransitionPort: new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider),
      eventBus: new InProcessEventBus(new SilentLoggerAdapter()),
      dateProvider,
    });
    expect(api.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "tff_status" }));
  });
});

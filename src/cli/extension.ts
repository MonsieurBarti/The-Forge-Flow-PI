import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { registerProjectExtension } from "@hexagons/project";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { NodeProjectFileSystemAdapter } from "@hexagons/project/infrastructure/node-project-filesystem.adapter";
import { MergeSettingsUseCase } from "@hexagons/settings";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { WorkflowSliceTransitionAdapter } from "@hexagons/slice/infrastructure/workflow-slice-transition.adapter";
import { CreateTasksUseCase } from "@hexagons/task/application/create-tasks.use-case";
import { DetectWavesUseCase } from "@hexagons/task/domain/detect-waves.use-case";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import {
  type ContextPackage,
  type ContextStagingError,
  ContextStagingPort,
  InMemoryWorkflowSessionRepository,
  registerWorkflowExtension,
} from "@hexagons/workflow";
import { NodeArtifactFileAdapter } from "@hexagons/workflow/infrastructure/node-artifact-file.adapter";
import type { ExtensionAPI } from "@infrastructure/pi";
import type { Result } from "@kernel";
import { ConsoleLoggerAdapter, InProcessEventBus, SystemDateProvider } from "@kernel";

class NoOpContextStaging extends ContextStagingPort {
  async stage(): Promise<Result<ContextPackage, ContextStagingError>> {
    throw new Error("ContextStagingPort: not yet implemented");
  }
}

export interface TffExtensionOptions {
  projectRoot: string;
}

export function createTffExtension(api: ExtensionAPI, options: TffExtensionOptions): void {
  // --- Shared infrastructure ---
  const logger = new ConsoleLoggerAdapter();
  const eventBus = new InProcessEventBus(logger);
  const dateProvider = new SystemDateProvider();

  // --- Repositories (in-memory for now; SQLite swap in later slice) ---
  const projectRepo = new InMemoryProjectRepository();
  const milestoneRepo = new InMemoryMilestoneRepository();
  const sliceRepo = new InMemorySliceRepository();
  const taskRepo = new InMemoryTaskRepository();

  // --- Hexagon extensions ---
  registerProjectExtension(api, {
    projectRoot: options.projectRoot,
    projectRepo,
    projectFs: new NodeProjectFileSystemAdapter(),
    mergeSettings: new MergeSettingsUseCase(),
    eventBus,
    dateProvider,
  });

  const sliceTransitionPort = new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider);
  const artifactFile = new NodeArtifactFileAdapter(options.projectRoot);
  const workflowSessionRepo = new InMemoryWorkflowSessionRepository();
  const autonomyModeProvider = { getAutonomyMode: () => "plan-to-pr" as const };

  registerWorkflowExtension(api, {
    projectRepo,
    milestoneRepo,
    sliceRepo,
    taskRepo,
    createTasksPort: new CreateTasksUseCase(taskRepo, new DetectWavesUseCase(), dateProvider),
    sliceTransitionPort,
    eventBus,
    dateProvider,
    contextStaging: new NoOpContextStaging(),
    artifactFile,
    workflowSessionRepo,
    autonomyModeProvider,
    maxRetries: 2,
  });
}

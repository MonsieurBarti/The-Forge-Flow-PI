import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecuteSliceUseCase } from "@hexagons/execution/application/execute-slice.use-case";
import { ReplayJournalUseCase } from "@hexagons/execution/application/replay-journal.use-case";
import { InMemoryCheckpointRepository } from "@hexagons/execution/infrastructure/in-memory-checkpoint.repository";
import { InMemoryJournalRepository } from "@hexagons/execution/infrastructure/in-memory-journal.repository";
import { MarkdownExecutionSessionAdapter } from "@hexagons/execution/infrastructure/markdown-execution-session.adapter";
import { registerExecutionExtension } from "@hexagons/execution/infrastructure/pi/execution.extension";
import { PiAgentDispatchAdapter } from "@hexagons/execution/infrastructure/pi-agent-dispatch.adapter";
import { ProcessSignalPauseAdapter } from "@hexagons/execution/infrastructure/process-signal-pause.adapter";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { registerProjectExtension } from "@hexagons/project";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { NodeProjectFileSystemAdapter } from "@hexagons/project/infrastructure/node-project-filesystem.adapter";
import { ConductReviewUseCase } from "@hexagons/review/application/conduct-review.use-case";
import { ReviewPromptBuilder } from "@hexagons/review/application/review-prompt-builder";
import { CritiqueReflectionService } from "@hexagons/review/domain/services/critique-reflection.service";
import { FreshReviewerService } from "@hexagons/review/domain/services/fresh-reviewer.service";
import { BeadSliceSpecAdapter } from "@hexagons/review/infrastructure/bead-slice-spec.adapter";
import { CachedExecutorQueryAdapter } from "@hexagons/review/infrastructure/cached-executor-query.adapter";
import { GitChangedFilesAdapter } from "@hexagons/review/infrastructure/git-changed-files.adapter";
import { InMemoryReviewRepository } from "@hexagons/review/infrastructure/in-memory-review.repository";
import { PlannotatorReviewUIAdapter } from "@hexagons/review/infrastructure/plannotator-review-ui.adapter";
import { StubFixerAdapter } from "@hexagons/review/infrastructure/stub-fixer.adapter";
import { TerminalReviewUIAdapter } from "@hexagons/review/infrastructure/terminal-review-ui.adapter";
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
import {
  AgentRegistry,
  AgentResourceLoader,
  ConsoleLoggerAdapter,
  err,
  GitCliAdapter,
  InProcessEventBus,
  initializeAgentRegistry,
  isAgentRegistryInitialized,
  type ModelProfileName,
  PersistenceError,
  type ResolvedModel,
  SystemDateProvider,
} from "@kernel";

function detectPlannotator(): string | undefined {
  try {
    return execFileSync("which", ["plannotator"], { encoding: "utf-8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

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

  // --- Agent registry ---
  if (!isAgentRegistryInitialized()) {
    const agentLoader = new AgentResourceLoader();
    const agentRegistryResult = AgentRegistry.loadFromResources(
      agentLoader,
      join(options.projectRoot, "src/resources"),
    );
    if (!agentRegistryResult.ok) {
      throw new Error(`Failed to load agent registry: ${agentRegistryResult.error.message}`);
    }
    initializeAgentRegistry(agentRegistryResult.data);
  }

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

  const plannotatorPath = detectPlannotator();
  const reviewUI = plannotatorPath
    ? new PlannotatorReviewUIAdapter(plannotatorPath)
    : new TerminalReviewUIAdapter();

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
    reviewUI,
    maxRetries: 2,
  });

  // --- Execution extension ---
  // Pause and resume tools are immediately usable via session persistence.
  // The execute tool delegates to ExecuteSliceUseCase, which requires the full
  // agent dispatch stack (worktree, guardrail, overseer, metrics, git).
  // The TFF workflow orchestrator assembles that stack at runtime.
  // TODO(M05): Replace the stub below with the fully-wired ExecuteSliceUseCase.
  const journalRepo = new InMemoryJournalRepository();
  const checkpointRepo = new InMemoryCheckpointRepository();
  const resolveSlicePath = (sliceId: string): Promise<Result<string, PersistenceError>> =>
    Promise.resolve(
      err(new PersistenceError(`Slice path resolver not configured for: ${sliceId}`)),
    );
  const sessionRepo = new MarkdownExecutionSessionAdapter(options.projectRoot, resolveSlicePath);
  const replayJournal = new ReplayJournalUseCase(journalRepo);
  const executeSliceStub: Pick<ExecuteSliceUseCase, "execute"> = {
    execute: () => Promise.reject(new Error("ExecuteSliceUseCase not wired — use TFF workflow")),
  };

  registerExecutionExtension(api, {
    sessionRepository: sessionRepo,
    pauseSignal: new ProcessSignalPauseAdapter(),
    executeSlice: executeSliceStub,
    replayJournal,
    checkpointRepository: checkpointRepo,
    eventBus,
    dateProvider,
    logger,
  });

  // --- Review pipeline wiring ---
  const gitPort = new GitCliAdapter(options.projectRoot);
  const reviewRepository = new InMemoryReviewRepository();
  const executorQueryAdapter = new CachedExecutorQueryAdapter(async (_sliceId) => {
    // Stub: returns empty set. Real implementation will query execution session.
    return { ok: true as const, data: new Set<string>() };
  });
  const freshReviewerService = new FreshReviewerService(executorQueryAdapter);
  const critiqueReflectionService = new CritiqueReflectionService();
  const templateLoader = (path: string) =>
    readFileSync(join(options.projectRoot, "src/resources", path), "utf-8");
  const reviewPromptBuilder = new ReviewPromptBuilder(templateLoader);
  const modelResolver = (_profile: ModelProfileName): ResolvedModel => ({
    provider: "anthropic",
    modelId: "claude-opus-4-6",
  });
  const beadSliceSpecAdapter = new BeadSliceSpecAdapter(
    (milestoneLabel, sliceLabel) => artifactFile.read(milestoneLabel, sliceLabel, "spec"),
    // TODO(M05-S09): Wire real label resolver from bead metadata
    (_sliceId) => ({
      milestoneLabel: "M05",
      sliceLabel: "S04",
      sliceTitle: "Review pipeline",
    }),
  );
  const gitChangedFilesAdapter = new GitChangedFilesAdapter(gitPort, (_sliceId) => "milestone/M05");
  const stubFixer = new StubFixerAdapter();

  const _conductReviewUseCase = new ConductReviewUseCase(
    beadSliceSpecAdapter,
    gitChangedFilesAdapter,
    freshReviewerService,
    new PiAgentDispatchAdapter(),
    critiqueReflectionService,
    reviewPromptBuilder,
    modelResolver,
    stubFixer,
    reviewRepository,
    eventBus,
    dateProvider,
    logger,
  );
  void _conductReviewUseCase; // TODO(M05-S09): wire to ship command
}

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecuteSliceUseCase } from "@hexagons/execution/application/execute-slice.use-case";
import { ReplayJournalUseCase } from "@hexagons/execution/application/replay-journal.use-case";
import { GitWorktreeAdapter } from "@kernel/infrastructure/worktree/git-worktree.adapter";
import { InMemoryCheckpointRepository } from "@hexagons/execution/infrastructure/repositories/checkpoint/in-memory-checkpoint.repository";
import { InMemoryJournalRepository } from "@hexagons/execution/infrastructure/repositories/journal/in-memory-journal.repository";
import { MarkdownExecutionSessionAdapter } from "@hexagons/execution/infrastructure/adapters/execution-session/markdown-execution-session.adapter";
import { registerExecutionExtension } from "@hexagons/execution/infrastructure/pi/execution.extension";
import { PiAgentDispatchAdapter } from "@hexagons/execution/infrastructure/adapters/agent-dispatch/pi-agent-dispatch.adapter";
import { ProcessSignalPauseAdapter } from "@hexagons/execution/infrastructure/adapters/pause-signal/process-signal-pause.adapter";
import { SqliteMilestoneRepository } from "@hexagons/milestone/infrastructure/sqlite-milestone.repository";
import { registerProjectExtension } from "@hexagons/project";
import { SqliteProjectRepository } from "@hexagons/project/infrastructure/sqlite-project.repository";
import { NodeProjectFileSystemAdapter } from "@hexagons/project/infrastructure/node-project-filesystem.adapter";
import { CompleteMilestoneUseCase } from "@hexagons/review/application/complete-milestone.use-case";
import { ConductReviewUseCase } from "@hexagons/review/application/conduct-review.use-case";
import { ReviewPromptBuilder } from "@hexagons/review/application/review-prompt-builder";
import { ShipSliceUseCase } from "@hexagons/review/application/ship-slice.use-case";
import { VerifyAcceptanceCriteriaUseCase } from "@hexagons/review/application/verify-acceptance-criteria.use-case";
import { CritiqueReflectionService } from "@hexagons/review/domain/services/critique-reflection.service";
import { FreshReviewerService } from "@hexagons/review/domain/services/fresh-reviewer.service";
import { BeadSliceSpecAdapter } from "@hexagons/review/infrastructure/adapters/slice-spec/bead-slice-spec.adapter";
import { CachedExecutorQueryAdapter } from "@hexagons/review/infrastructure/adapters/executor-query/cached-executor-query.adapter";
import { GitChangedFilesAdapter } from "@hexagons/review/infrastructure/adapters/changed-files/git-changed-files.adapter";
import { InMemoryReviewRepository } from "@hexagons/review/infrastructure/repositories/review/in-memory-review.repository";
import { InMemoryReviewUIAdapter } from "@hexagons/review/infrastructure/adapters/review-ui/in-memory-review-ui.adapter";
import { InMemoryVerificationRepository } from "@hexagons/review/infrastructure/repositories/verification/in-memory-verification.repository";
import { MilestoneQueryAdapter } from "@hexagons/review/infrastructure/adapters/milestone/milestone-query.adapter";
import { MilestoneTransitionAdapter } from "@hexagons/review/infrastructure/adapters/milestone/milestone-transition.adapter";
import { PiAuditAdapter } from "@hexagons/review/infrastructure/adapters/audit/pi-audit.adapter";
import { PiFixerAdapter } from "@hexagons/review/infrastructure/adapters/fixer/pi-fixer.adapter";
import { PiMergeGateAdapter } from "@hexagons/review/infrastructure/adapters/merge-gate/pi-merge-gate.adapter";
import { PlannotatorReviewUIAdapter } from "@hexagons/review/infrastructure/adapters/review-ui/plannotator-review-ui.adapter";
import { SqliteCompletionRecordRepository } from "@hexagons/review/infrastructure/repositories/completion-record/sqlite-completion-record.repository";
import { SqliteShipRecordRepository } from "@hexagons/review/infrastructure/repositories/ship-record/sqlite-ship-record.repository";
import { TerminalReviewUIAdapter } from "@hexagons/review/infrastructure/adapters/review-ui/terminal-review-ui.adapter";
import { HOTKEYS_DEFAULTS, MergeSettingsUseCase } from "@hexagons/settings";
import { SqliteSliceRepository } from "@hexagons/slice/infrastructure/sqlite-slice.repository";
import { WorkflowSliceTransitionAdapter } from "@hexagons/slice/infrastructure/workflow-slice-transition.adapter";
import { CreateTasksUseCase } from "@hexagons/task/application/create-tasks.use-case";
import { DetectWavesUseCase } from "@hexagons/task/domain/detect-waves.use-case";
import { SqliteTaskRepository } from "@hexagons/task/infrastructure/sqlite-task.repository";
import {
  type ContextPackage,
  type ContextStagingError,
  ContextStagingPort,
  InMemoryWorkflowSessionRepository,
  registerWorkflowExtension,
} from "@hexagons/workflow";
import { NodeArtifactFileAdapter } from "@hexagons/workflow/infrastructure/node-artifact-file.adapter";
import { AlwaysUnderBudgetAdapter } from "@hexagons/settings/infrastructure/always-under-budget.adapter";
import { OverlayDataAdapter } from "./infrastructure/overlay-data.adapter";
import { registerOverlayExtension } from "./overlay.extension";
import type { ExtensionAPI } from "@infrastructure/pi";
import type { Result } from "@kernel";
import {
  AgentRegistry,
  AgentResourceLoader,
  ConsoleLoggerAdapter,
  err,
  GitCliAdapter,
  InMemoryAgentEventHub,
  InProcessEventBus,
  initializeAgentRegistry,
  isAgentRegistryInitialized,
  type ModelProfileName,
  PersistenceError,
  type ResolvedModel,
  SystemDateProvider,
} from "@kernel";
import { GhCliAdapter } from "@kernel/infrastructure/gh-cli.adapter";
import { GitHookAdapter } from "@kernel/infrastructure/git-hook/git-hook.adapter";
import { GitStateBranchOpsAdapter } from "@kernel/infrastructure/state-branch/git-state-branch-ops.adapter";
import { GitStateSyncAdapter } from "@kernel/infrastructure/state-branch/git-state-sync.adapter";
import { AdvisoryLock } from "@kernel/infrastructure/state-branch/advisory-lock";
import { StateBranchCreationHandler } from "@kernel/infrastructure/state-branch/state-branch-creation.handler";
import { BackupService } from "@kernel/services/backup-service";
import { RestoreStateUseCase } from "@kernel/services/restore-state.use-case";
import { HealthCheckService } from "@kernel/services/health-check.service";
import { StateGuard } from "@kernel/services/state-guard";
import { ForceSyncUseCase } from "@kernel/services/force-sync.use-case";
import { StateRecoveryAdapter } from "@kernel/infrastructure/state-recovery/state-recovery.adapter";
import { CrashRecoveryStrategy } from "@kernel/infrastructure/state-recovery/crash-recovery.strategy";
import { MismatchRecoveryStrategy } from "@kernel/infrastructure/state-recovery/mismatch-recovery.strategy";
import { RenameRecoveryStrategy } from "@kernel/infrastructure/state-recovery/rename-recovery.strategy";
import { FreshCloneStrategy } from "@kernel/infrastructure/state-recovery/fresh-clone.strategy";
import type { RecoveryType } from "@kernel/schemas/recovery.schemas";
import type { RecoveryStrategy } from "@kernel/ports/recovery-strategy";
import { StateExporter } from "@kernel/services/state-exporter";
import { StateImporter } from "@kernel/services/state-importer";
import Database from "better-sqlite3";

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
  const agentEventHub = new InMemoryAgentEventHub();
  const sharedAgentDispatch = new PiAgentDispatchAdapter({ agentEventPort: agentEventHub });

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

  // --- Core infrastructure ---
  const gitPort = new GitCliAdapter(options.projectRoot);

  // --- tffDir resolution ---
  const rootTffDir = join(options.projectRoot, ".tff");
  mkdirSync(rootTffDir, { recursive: true });
  const worktreeAdapter = new GitWorktreeAdapter(gitPort, options.projectRoot);
  const resolveActiveTffDir = async (sliceId?: string): Promise<string> => {
    if (sliceId && (await worktreeAdapter.exists(sliceId))) {
      return worktreeAdapter.resolveTffDir(sliceId);
    }
    return rootTffDir;
  };

  // --- Shared SQLite database for core entities ---
  const stateDb = new Database(join(rootTffDir, "state.db"));

  // --- Repositories (SQLite-backed) ---
  const projectRepo = new SqliteProjectRepository(stateDb);
  const milestoneRepo = new SqliteMilestoneRepository(stateDb);
  const sliceRepo = new SqliteSliceRepository(stateDb);
  const taskRepo = new SqliteTaskRepository(stateDb);

  // --- Shared infrastructure ---
  const gitHookAdapter = new GitHookAdapter(join(options.projectRoot, ".git"));

  // --- Hexagon extensions ---
  registerProjectExtension(api, {
    projectRoot: options.projectRoot,
    projectRepo,
    projectFs: new NodeProjectFileSystemAdapter(),
    mergeSettings: new MergeSettingsUseCase(),
    eventBus,
    dateProvider,
    gitHookPort: gitHookAdapter,
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
    resolveActiveTffDir,
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
    (sliceId) => {
      // Bead IDs: "The-Forge-Flow-PI-4t7.X.Y" where X=milestone, Y=slice
      const match = sliceId.match(/\.(\d+)\.(\d+)$/);
      if (!match) {
        // Fallback: try parsing "M05-S09" format directly
        const labelMatch = sliceId.match(/M(\d+)-S(\d+)/);
        if (labelMatch) {
          const mLabel = `M${labelMatch[1].padStart(2, "0")}`;
          const sLabel = `${mLabel}-S${labelMatch[2].padStart(2, "0")}`;
          return { milestoneLabel: mLabel, sliceLabel: sLabel, sliceTitle: sLabel };
        }
        throw new Error(`Cannot resolve labels for sliceId: ${sliceId}`);
      }
      const milestoneLabel = `M${match[1].padStart(2, "0")}`;
      const sliceLabel = `${milestoneLabel}-S${match[2].padStart(2, "0")}`;
      try {
        const output = execFileSync("bd", ["show", sliceId, "--json"], { encoding: "utf-8" });
        const parsed: unknown = JSON.parse(output);
        const entry: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
        let titleStr = sliceLabel;
        if (entry !== null && typeof entry === "object" && "title" in entry) {
          const { title } = entry;
          if (typeof title === "string") titleStr = title;
        }
        return { milestoneLabel, sliceLabel, sliceTitle: titleStr.replace(/^M\d+-S\d+:\s*/, "") };
      } catch {
        return { milestoneLabel, sliceLabel, sliceTitle: sliceLabel };
      }
    },
  );
  const gitChangedFilesAdapter = new GitChangedFilesAdapter(gitPort, (sliceId) => {
    const match = sliceId.match(/\.(\d+)\.\d+$/);
    if (match) return `milestone/M${match[1].padStart(2, "0")}`;
    const labelMatch = sliceId.match(/M(\d+)/);
    if (labelMatch) return `milestone/M${labelMatch[1].padStart(2, "0")}`;
    return "milestone/M05";
  });
  const piFixerAdapter = new PiFixerAdapter(
    sharedAgentDispatch,
    templateLoader,
    modelResolver,
    logger,
  );

  const conductReviewUseCase = new ConductReviewUseCase(
    beadSliceSpecAdapter,
    gitChangedFilesAdapter,
    freshReviewerService,
    sharedAgentDispatch,
    critiqueReflectionService,
    reviewPromptBuilder,
    modelResolver,
    piFixerAdapter,
    reviewRepository,
    eventBus,
    dateProvider,
    logger,
  );

  // --- Verify pipeline wiring ---
  const verificationRepository = new InMemoryVerificationRepository();
  const verifyUseCase = new VerifyAcceptanceCriteriaUseCase(
    beadSliceSpecAdapter,
    freshReviewerService,
    sharedAgentDispatch,
    piFixerAdapter,
    verificationRepository,
    new InMemoryReviewUIAdapter(), // TODO(M05-S09): wire ReviewUIPort adapter selection
    modelResolver,
    eventBus,
    dateProvider,
    () => crypto.randomUUID(),
    logger,
    templateLoader,
  );
  void verifyUseCase; // Available for verify command wiring

  // --- State sync wiring (moved before ship/complete for dependency injection) ---
  const ghCliAdapter = new GhCliAdapter(options.projectRoot);
  const mergeGateAdapter = new PiMergeGateAdapter();
  const shipRecordDb = new Database(join(rootTffDir, "ship-records.db"));
  const shipRecordRepository = new SqliteShipRecordRepository(shipRecordDb);
  const completionRecordDb = new Database(join(rootTffDir, "completion-records.db"));
  const completionRecordRepository = new SqliteCompletionRecordRepository(completionRecordDb);

  const stateBranchOps = new GitStateBranchOpsAdapter(options.projectRoot);
  const stateExporter = new StateExporter({
    projectRepo,
    milestoneRepo,
    sliceRepo,
    taskRepo,
    shipRecordRepo: shipRecordRepository,
    completionRecordRepo: completionRecordRepository,
  });
  const stateImporter = new StateImporter({
    projectRepo,
    milestoneRepo,
    sliceRepo,
    taskRepo,
    shipRecordRepo: shipRecordRepository,
    completionRecordRepo: completionRecordRepository,
  });
  const gitStateSyncAdapter = new GitStateSyncAdapter({
    stateBranchOps,
    stateExporter,
    stateImporter,
    advisoryLock: new AdvisoryLock(),
    tffDir: rootTffDir,
    projectRoot: options.projectRoot,
  });
  const stateBranchCreationHandler = new StateBranchCreationHandler(
    gitStateSyncAdapter,
    milestoneRepo,
    sliceRepo,
    logger,
  );
  stateBranchCreationHandler.register(eventBus);

  // --- Ship pipeline wiring ---
  const shipSliceUseCase = new ShipSliceUseCase(
    beadSliceSpecAdapter,
    ghCliAdapter,
    mergeGateAdapter,
    shipRecordRepository,
    conductReviewUseCase,
    piFixerAdapter,
    gitPort,
    worktreeAdapter,
    sliceTransitionPort,
    eventBus,
    dateProvider,
    () => crypto.randomUUID(),
    logger,
    gitStateSyncAdapter,
    options.projectRoot,
  );
  void shipSliceUseCase;

  // --- Complete milestone pipeline wiring ---
  const milestoneQueryAdapter = new MilestoneQueryAdapter(
    sliceRepo,
    milestoneRepo,
    options.projectRoot,
  );
  const milestoneTransitionAdapter = new MilestoneTransitionAdapter(milestoneRepo, dateProvider);
  const piAuditAdapter = new PiAuditAdapter(
    new PiAgentDispatchAdapter(),
    templateLoader,
    modelResolver,
    logger,
  );

  const completeMilestoneUseCase = new CompleteMilestoneUseCase(
    milestoneQueryAdapter,
    piAuditAdapter,
    ghCliAdapter,
    mergeGateAdapter,
    completionRecordRepository,
    piFixerAdapter,
    gitPort,
    milestoneTransitionAdapter,
    eventBus,
    dateProvider,
    () => crypto.randomUUID(),
    logger,
    gitStateSyncAdapter,
  );
  void completeMilestoneUseCase;

  // --- Restore + guard wiring ---
  const backupService = new BackupService();
  const restoreUseCase = new RestoreStateUseCase({
    stateSync: gitStateSyncAdapter,
    gitPort,
    advisoryLock: new AdvisoryLock(),
    stateExporter,
    backupService,
    tffDir: rootTffDir,
  });
  const hookScript =
    'if [ "$3" = "1" ]; then\n  node -e "require(\'./node_modules/.tff-restore.js\')" 2>/dev/null || true\nfi';
  const healthCheckService = new HealthCheckService({
    gitHookPort: gitHookAdapter,
    stateBranchOps,
    gitPort,
    hookScriptContent: hookScript,
    projectRoot: options.projectRoot,
  });

  const strategies = new Map<RecoveryType, RecoveryStrategy>([
    ['crash', new CrashRecoveryStrategy(backupService, stateBranchOps, restoreUseCase)],
    ['mismatch', new MismatchRecoveryStrategy(restoreUseCase)],
    ['rename', new RenameRecoveryStrategy(stateBranchOps)],
    ['fresh-clone', new FreshCloneStrategy(backupService, stateBranchOps, restoreUseCase, healthCheckService, options.projectRoot)],
  ]);
  const stateRecoveryAdapter = new StateRecoveryAdapter(strategies, gitPort, stateBranchOps, options.projectRoot);
  const stateGuard = new StateGuard(stateRecoveryAdapter, healthCheckService);

  const forceSyncUseCase = new ForceSyncUseCase(gitStateSyncAdapter, restoreUseCase, gitPort);

  // --- /tff:sync command ---
  api.registerCommand("tff:sync", {
    description: "Force-push or force-pull state to/from state branch",
    handler: async (args: string) => {
      const guardResult = await stateGuard.ensure(rootTffDir);
      if (!guardResult.ok) {
        api.sendUserMessage(`State guard failed: ${guardResult.error.message}`);
        return;
      }
      const isPull = args.trim() === "--pull";
      if (isPull) {
        const pullResult = await forceSyncUseCase.pull(rootTffDir);
        api.sendUserMessage(pullResult.ok
          ? `Pulled state from state branch (${pullResult.data.filesRestored} files restored)`
          : `Pull failed: ${pullResult.error.message}`);
      } else {
        const pushResult = await forceSyncUseCase.push(rootTffDir);
        api.sendUserMessage(pushResult.ok
          ? "State pushed to state branch"
          : `Push failed: ${pushResult.error.message}`);
      }
    },
  });

  // --- Overlay extension wiring ---
  const overlayDataAdapter = new OverlayDataAdapter(
    projectRepo,
    milestoneRepo,
    sliceRepo,
    taskRepo,
  );

  const mergeSettings = new MergeSettingsUseCase();
  const settingsResult = mergeSettings.execute({ team: null, local: null, env: {} });
  const hotkeys = settingsResult.ok ? settingsResult.data.hotkeys : HOTKEYS_DEFAULTS;

  const budgetTrackingPort = new AlwaysUnderBudgetAdapter();
  registerOverlayExtension(api, {
    overlayDataPort: overlayDataAdapter,
    budgetTrackingPort,
    eventBus,
    agentEventPort: agentEventHub,
    hotkeys,
    logger,
  });
}

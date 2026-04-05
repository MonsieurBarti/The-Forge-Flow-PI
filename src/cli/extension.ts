import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ExecuteSliceUseCase } from "@hexagons/execution/application/execute-slice.use-case";
import { GetSliceExecutorsUseCase } from "@hexagons/execution/application/get-slice-executors.use-case";
import { ReplayJournalUseCase } from "@hexagons/execution/application/replay-journal.use-case";
import { GitWorktreeAdapter } from "@kernel/infrastructure/worktree/git-worktree.adapter";
import { JsonlJournalRepository } from "@hexagons/execution/infrastructure/repositories/journal/jsonl-journal.repository";
import { MarkdownCheckpointRepository } from "@hexagons/execution/infrastructure/repositories/checkpoint/markdown-checkpoint.repository";
import { JsonlMetricsRepository } from "@hexagons/execution/infrastructure/repositories/metrics/jsonl-metrics.repository";
import { ComposableGuardrailAdapter } from "@hexagons/execution/infrastructure/adapters/guardrails/composable-guardrail.adapter";
import { ComposableOverseerAdapter } from "@hexagons/execution/infrastructure/adapters/overseer/composable-overseer.adapter";
import { ComposablePreDispatchAdapter } from "@hexagons/execution/infrastructure/adapters/pre-dispatch/composable-pre-dispatch.adapter";
import { DefaultRetryPolicy } from "@hexagons/execution/infrastructure/policies/default-retry-policy";
import { TimeoutStrategy } from "@hexagons/execution/infrastructure/policies/timeout-strategy";
import { OverseerConfigSchema } from "@hexagons/execution/domain/overseer.schemas";
import { DangerousCommandRule } from "@hexagons/execution/infrastructure/adapters/guardrails/rules/dangerous-command.rule";
import { CredentialExposureRule } from "@hexagons/execution/infrastructure/adapters/guardrails/rules/credential-exposure.rule";
import { DestructiveGitRule } from "@hexagons/execution/infrastructure/adapters/guardrails/rules/destructive-git.rule";
import { FileScopeRule } from "@hexagons/execution/infrastructure/adapters/guardrails/rules/file-scope.rule";
import { SuspiciousContentRule } from "@hexagons/execution/infrastructure/adapters/guardrails/rules/suspicious-content.rule";
import { ScopeContainmentRule } from "@hexagons/execution/infrastructure/adapters/pre-dispatch/rules/scope-containment.rule";
import { DependencyCheckRule } from "@hexagons/execution/infrastructure/adapters/pre-dispatch/rules/dependency-check.rule";
import { ToolPolicyRule } from "@hexagons/execution/infrastructure/adapters/pre-dispatch/rules/tool-policy.rule";
import { WorktreeStateRule, type WorktreeStateGitOps } from "@hexagons/execution/infrastructure/adapters/pre-dispatch/rules/worktree-state.rule";
import { BudgetCheckRule } from "@hexagons/execution/infrastructure/adapters/pre-dispatch/rules/budget-check.rule";
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
import { SqliteReviewRepository } from "@hexagons/review/infrastructure/repositories/review/sqlite-review.repository";
import { SqliteVerificationRepository } from "@hexagons/review/infrastructure/repositories/verification/sqlite-verification.repository";
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
  DefaultContextStagingAdapter,
  JsonlWorkflowJournalRepository,
  SettingsModelProfileResolver,
  SqliteWorkflowSessionRepository,
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

  const sliceTransitionPort = new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider);
  const artifactFile = new NodeArtifactFileAdapter(options.projectRoot);
  const workflowSessionRepo = new SqliteWorkflowSessionRepository(stateDb);
  const autonomyModeProvider = { getAutonomyMode: () => "plan-to-pr" as const };

  const plannotatorPath = detectPlannotator();
  const reviewUI = plannotatorPath
    ? new PlannotatorReviewUIAdapter(plannotatorPath)
    : new TerminalReviewUIAdapter();

  // --- Shared: modelResolver + templateLoader (needed by execution & review) ---
  const templateLoader = (path: string) =>
    readFileSync(join(options.projectRoot, "src/resources", path), "utf-8");
  const modelResolver = (_profile: ModelProfileName): ResolvedModel => ({
    provider: "anthropic",
    modelId: "claude-opus-4-6",
  });

  // --- Execution extension ---
  const journalRepo = new JsonlJournalRepository(join(rootTffDir, "journal"));
  const checkpointRepo = new MarkdownCheckpointRepository(
    options.projectRoot,
    async (sliceId) => {
      if (await worktreeAdapter.exists(sliceId)) {
        return { ok: true as const, data: join(".tff", "worktrees", sliceId) };
      }
      return err(new PersistenceError(`No worktree for slice: ${sliceId}`));
    },
  );
  const resolveSlicePath = async (sliceId: string): Promise<Result<string, PersistenceError>> => {
    if (await worktreeAdapter.exists(sliceId)) {
      return { ok: true as const, data: join(".tff", "worktrees", sliceId) };
    }
    return err(new PersistenceError(`No worktree for slice: ${sliceId}`));
  };
  const sessionRepo = new MarkdownExecutionSessionAdapter(options.projectRoot, resolveSlicePath);
  const replayJournal = new ReplayJournalUseCase(journalRepo);

  // --- ExecuteSliceUseCase full wiring ---
  const metricsRepo = new JsonlMetricsRepository(join(rootTffDir, "metrics.jsonl"));
  const overseerConfig = OverseerConfigSchema.parse({});
  const guardrail = new ComposableGuardrailAdapter(
    [new DangerousCommandRule(), new CredentialExposureRule(), new DestructiveGitRule(), new FileScopeRule(), new SuspiciousContentRule()],
    new Map(),
    gitPort,
  );
  const overseer = new ComposableOverseerAdapter([new TimeoutStrategy(overseerConfig)]);
  const retryPolicy = new DefaultRetryPolicy(2, overseerConfig.retryLoop.threshold);
  const worktreeStateGitOps: WorktreeStateGitOps = {
    async statusAt(cwd: string) {
      const result = await gitPort.statusAt(cwd);
      if (!result.ok) return { ok: false as const, error: result.error };
      return { ok: true as const, value: { branch: result.data.branch, clean: result.data.clean } };
    },
  };
  const preDispatchGuardrail = new ComposablePreDispatchAdapter([
    new ScopeContainmentRule(), new DependencyCheckRule(), new ToolPolicyRule(),
    new WorktreeStateRule(worktreeStateGitOps), new BudgetCheckRule(),
  ]);
  const executeProtocol = readFileSync(join(options.projectRoot, "src/resources/protocols/execute.md"), "utf-8");

  const executeSlice = new ExecuteSliceUseCase({
    taskRepository: taskRepo,
    waveDetection: new DetectWavesUseCase(),
    checkpointRepository: checkpointRepo,
    agentDispatch: sharedAgentDispatch,
    worktree: worktreeAdapter,
    eventBus,
    journalRepository: journalRepo,
    metricsRepository: metricsRepo,
    dateProvider,
    logger,
    templateContent: executeProtocol,
    guardrail,
    gitPort,
    overseer,
    retryPolicy,
    overseerConfig,
    preDispatchGuardrail,
    modelResolver,
    checkpointBeforeRetry: true,
  });

  registerExecutionExtension(api, {
    sessionRepository: sessionRepo,
    pauseSignal: new ProcessSignalPauseAdapter(),
    executeSlice,
    replayJournal,
    checkpointRepository: checkpointRepo,
    eventBus,
    dateProvider,
    logger,
  });

  // --- Review pipeline wiring ---
  const reviewRepository = new SqliteReviewRepository(stateDb);
  const getSliceExecutors = new GetSliceExecutorsUseCase(checkpointRepo);
  const executorQueryAdapter = new CachedExecutorQueryAdapter(
    async (sliceId) => getSliceExecutors.execute(sliceId),
  );
  const freshReviewerService = new FreshReviewerService(executorQueryAdapter);
  const critiqueReflectionService = new CritiqueReflectionService();
  const reviewPromptBuilder = new ReviewPromptBuilder(templateLoader);
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
  const verificationRepository = new SqliteVerificationRepository(stateDb);
  const verifyUseCase = new VerifyAcceptanceCriteriaUseCase(
    beadSliceSpecAdapter,
    freshReviewerService,
    sharedAgentDispatch,
    piFixerAdapter,
    verificationRepository,
    reviewUI,
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
    workflowSessionRepo,
    reviewRepo: reviewRepository,
    verificationRepo: verificationRepository,
  });
  const stateImporter = new StateImporter({
    projectRepo,
    milestoneRepo,
    sliceRepo,
    taskRepo,
    shipRecordRepo: shipRecordRepository,
    completionRecordRepo: completionRecordRepository,
    workflowSessionRepo,
    reviewRepo: reviewRepository,
    verificationRepo: verificationRepository,
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
  const stateGuard = new StateGuard(stateRecoveryAdapter, healthCheckService, logger);

  const forceSyncUseCase = new ForceSyncUseCase(gitStateSyncAdapter, restoreUseCase, gitPort);

  // --- withGuard helper ---
  const withGuard = async (): Promise<void> => {
    const result = await stateGuard.ensure(rootTffDir);
    if (!result.ok) {
      api.sendUserMessage(`State guard failed: ${result.error.message}`);
    }
  };

  // --- Hexagon extensions (registered after withGuard is available) ---
  registerProjectExtension(api, {
    projectRoot: options.projectRoot,
    projectRepo,
    projectFs: new NodeProjectFileSystemAdapter(),
    mergeSettings: new MergeSettingsUseCase(),
    eventBus,
    dateProvider,
    gitHookPort: gitHookAdapter,
    withGuard,
  });

  const settingsResolver = new SettingsModelProfileResolver(new MergeSettingsUseCase());
  const contextStaging = new DefaultContextStagingAdapter({ modelProfileResolver: settingsResolver });
  const workflowJournal = new JsonlWorkflowJournalRepository(join(rootTffDir, "workflow-journal.jsonl"));

  registerWorkflowExtension(api, {
    projectRepo,
    milestoneRepo,
    sliceRepo,
    taskRepo,
    createTasksPort: new CreateTasksUseCase(taskRepo, new DetectWavesUseCase(), dateProvider),
    sliceTransitionPort,
    eventBus,
    dateProvider,
    contextStaging,
    artifactFile,
    workflowSessionRepo,
    autonomyModeProvider,
    reviewUI,
    maxRetries: 2,
    resolveActiveTffDir,
    withGuard,
    workflowJournal,
  });

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

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ExecuteSliceUseCase } from "@hexagons/execution/application/execute-slice.use-case";
import { GetSliceExecutorsUseCase } from "@hexagons/execution/application/get-slice-executors.use-case";
import { ReplayJournalUseCase } from "@hexagons/execution/application/replay-journal.use-case";
import { RollbackSliceUseCase } from "@hexagons/execution/application/rollback-slice.use-case";
import { OverseerConfigSchema } from "@hexagons/execution/domain/overseer.schemas";
import { PiAgentDispatchAdapter } from "@hexagons/execution/infrastructure/adapters/agent-dispatch/pi-agent-dispatch.adapter";
import { MarkdownExecutionSessionAdapter } from "@hexagons/execution/infrastructure/adapters/execution-session/markdown-execution-session.adapter";
import { ComposableGuardrailAdapter } from "@hexagons/execution/infrastructure/adapters/guardrails/composable-guardrail.adapter";
import { CredentialExposureRule } from "@hexagons/execution/infrastructure/adapters/guardrails/rules/credential-exposure.rule";
import { DangerousCommandRule } from "@hexagons/execution/infrastructure/adapters/guardrails/rules/dangerous-command.rule";
import { DestructiveGitRule } from "@hexagons/execution/infrastructure/adapters/guardrails/rules/destructive-git.rule";
import { FileScopeRule } from "@hexagons/execution/infrastructure/adapters/guardrails/rules/file-scope.rule";
import { SuspiciousContentRule } from "@hexagons/execution/infrastructure/adapters/guardrails/rules/suspicious-content.rule";
import { ComposableOverseerAdapter } from "@hexagons/execution/infrastructure/adapters/overseer/composable-overseer.adapter";
import { ProcessSignalPauseAdapter } from "@hexagons/execution/infrastructure/adapters/pause-signal/process-signal-pause.adapter";
import { ComposablePreDispatchAdapter } from "@hexagons/execution/infrastructure/adapters/pre-dispatch/composable-pre-dispatch.adapter";
import { BudgetCheckRule } from "@hexagons/execution/infrastructure/adapters/pre-dispatch/rules/budget-check.rule";
import { DependencyCheckRule } from "@hexagons/execution/infrastructure/adapters/pre-dispatch/rules/dependency-check.rule";
import { ScopeContainmentRule } from "@hexagons/execution/infrastructure/adapters/pre-dispatch/rules/scope-containment.rule";
import { ToolPolicyRule } from "@hexagons/execution/infrastructure/adapters/pre-dispatch/rules/tool-policy.rule";
import {
  type WorktreeStateGitOps,
  WorktreeStateRule,
} from "@hexagons/execution/infrastructure/adapters/pre-dispatch/rules/worktree-state.rule";
import { registerExecutionExtension } from "@hexagons/execution/infrastructure/pi/execution.extension";
import { DefaultRetryPolicy } from "@hexagons/execution/infrastructure/policies/default-retry-policy";
import { TimeoutStrategy } from "@hexagons/execution/infrastructure/policies/timeout-strategy";
import { MarkdownCheckpointRepository } from "@hexagons/execution/infrastructure/repositories/checkpoint/markdown-checkpoint.repository";
import { JsonlJournalRepository } from "@hexagons/execution/infrastructure/repositories/journal/jsonl-journal.repository";
import { JsonlMetricsRepository } from "@hexagons/execution/infrastructure/repositories/metrics/jsonl-metrics.repository";
import { registerMilestoneExtension } from "@hexagons/milestone/infrastructure/pi/milestone.extension";
import { SqliteMilestoneRepository } from "@hexagons/milestone/infrastructure/sqlite-milestone.repository";
import { CreateMilestoneUseCase } from "@hexagons/milestone/use-cases/create-milestone.use-case";
import { registerProjectExtension } from "@hexagons/project";
import { NodeProjectFileSystemAdapter } from "@hexagons/project/infrastructure/node-project-filesystem.adapter";
import { SqliteProjectRepository } from "@hexagons/project/infrastructure/sqlite-project.repository";
import { AuditMilestoneUseCase } from "@hexagons/review/application/audit-milestone.use-case";
import { CompleteMilestoneUseCase } from "@hexagons/review/application/complete-milestone.use-case";
import { ConductReviewUseCase } from "@hexagons/review/application/conduct-review.use-case";
import { ReviewPromptBuilder } from "@hexagons/review/application/review-prompt-builder";
import { ShipSliceUseCase } from "@hexagons/review/application/ship-slice.use-case";
import { VerifyAcceptanceCriteriaUseCase } from "@hexagons/review/application/verify-acceptance-criteria.use-case";
import { ExecutorQueryError } from "@hexagons/review/domain/errors/executor-query.error";
import { CritiqueReflectionService } from "@hexagons/review/domain/services/critique-reflection.service";
import { FreshReviewerService } from "@hexagons/review/domain/services/fresh-reviewer.service";
import { PiAuditAdapter } from "@hexagons/review/infrastructure/adapters/audit/pi-audit.adapter";
import { GitChangedFilesAdapter } from "@hexagons/review/infrastructure/adapters/changed-files/git-changed-files.adapter";
import { CachedExecutorQueryAdapter } from "@hexagons/review/infrastructure/adapters/executor-query/cached-executor-query.adapter";
import { PiFixerAdapter } from "@hexagons/review/infrastructure/adapters/fixer/pi-fixer.adapter";
import { PiMergeGateAdapter } from "@hexagons/review/infrastructure/adapters/merge-gate/pi-merge-gate.adapter";
import { MilestoneQueryAdapter } from "@hexagons/review/infrastructure/adapters/milestone/milestone-query.adapter";
import { MilestoneTransitionAdapter } from "@hexagons/review/infrastructure/adapters/milestone/milestone-transition.adapter";
import { PlannotatorReviewUIAdapter } from "@hexagons/review/infrastructure/adapters/review-ui/plannotator-review-ui.adapter";
import { TerminalReviewUIAdapter } from "@hexagons/review/infrastructure/adapters/review-ui/terminal-review-ui.adapter";
import { BeadSliceSpecAdapter } from "@hexagons/review/infrastructure/adapters/slice-spec/bead-slice-spec.adapter";
import { registerAuditMilestoneCommand } from "@hexagons/review/infrastructure/pi/audit-milestone.command";
import { createAuditMilestoneTool } from "@hexagons/review/infrastructure/pi/audit-milestone.tool";
import { SqliteCompletionRecordRepository } from "@hexagons/review/infrastructure/repositories/completion-record/sqlite-completion-record.repository";
import { SqliteMilestoneAuditRecordRepository } from "@hexagons/review/infrastructure/repositories/milestone-audit-record/sqlite-milestone-audit-record.repository";
import { SqliteReviewRepository } from "@hexagons/review/infrastructure/repositories/review/sqlite-review.repository";
import { SqliteShipRecordRepository } from "@hexagons/review/infrastructure/repositories/ship-record/sqlite-ship-record.repository";
import { SqliteVerificationRepository } from "@hexagons/review/infrastructure/repositories/verification/sqlite-verification.repository";
import {
  DiscoverStackUseCase,
  HOTKEYS_DEFAULTS,
  LoadSettingsUseCase,
  MergeSettingsUseCase,
} from "@hexagons/settings";
import { FormatSettingsCascadeService } from "@hexagons/settings/domain/services/format-settings-cascade.service";
import { FsSettingsFileAdapter } from "@hexagons/settings/infrastructure/fs-settings-file.adapter";
import { LoggingBudgetAdapter } from "@hexagons/settings/infrastructure/logging-budget.adapter";
import { ProcessEnvVarAdapter } from "@hexagons/settings/infrastructure/process-env-var.adapter";
import { AddSliceUseCase } from "@hexagons/slice/application/add-slice.use-case";
import { RemoveSliceUseCase } from "@hexagons/slice/application/remove-slice.use-case";
import { registerAddSliceCommand } from "@hexagons/slice/infrastructure/pi/add-slice.command";
import { createAddSliceTool } from "@hexagons/slice/infrastructure/pi/add-slice.tool";
import { registerRemoveSliceCommand } from "@hexagons/slice/infrastructure/pi/remove-slice.command";
import { createRemoveSliceTool } from "@hexagons/slice/infrastructure/pi/remove-slice.tool";
import { SqliteSliceRepository } from "@hexagons/slice/infrastructure/sqlite-slice.repository";
import { WorkflowSliceTransitionAdapter } from "@hexagons/slice/infrastructure/workflow-slice-transition.adapter";
import { CreateTasksUseCase } from "@hexagons/task/application/create-tasks.use-case";
import { DetectWavesUseCase } from "@hexagons/task/domain/detect-waves.use-case";
import { SqliteTaskRepository } from "@hexagons/task/infrastructure/sqlite-task.repository";
import {
  DefaultContextStagingAdapter,
  GetStatusUseCase,
  JsonlWorkflowJournalRepository,
  registerWorkflowExtension,
  SettingsModelProfileResolver,
  SqliteWorkflowSessionRepository,
} from "@hexagons/workflow";
import { MapCodebaseUseCase } from "@hexagons/workflow/application/map-codebase.use-case";
import { NodeArtifactFileAdapter } from "@hexagons/workflow/infrastructure/node-artifact-file.adapter";
import { registerHealthCommand } from "@hexagons/workflow/infrastructure/pi/health.command";
import { createHealthCheckTool } from "@hexagons/workflow/infrastructure/pi/health-check.tool";
import { registerHelpCommand } from "@hexagons/workflow/infrastructure/pi/help.command";
import { registerMapCodebaseCommand } from "@hexagons/workflow/infrastructure/pi/map-codebase.command";
import { createMapCodebaseTool } from "@hexagons/workflow/infrastructure/pi/map-codebase.tool";
import { registerProgressCommand } from "@hexagons/workflow/infrastructure/pi/progress.command";
import { createProgressTool } from "@hexagons/workflow/infrastructure/pi/progress.tool";
import { registerRepairBranchesCommand } from "@hexagons/workflow/infrastructure/pi/repair-branches.command";
import { registerSettingsCommand } from "@hexagons/workflow/infrastructure/pi/settings.command";
import { createReadSettingsTool } from "@hexagons/workflow/infrastructure/pi/settings-read.tool";
import { createUpdateSettingTool } from "@hexagons/workflow/infrastructure/pi/settings-update.tool";
import { PiDocWriterAdapter } from "@hexagons/workflow/infrastructure/pi-doc-writer.adapter";
// import { SuggestNextStepUseCase } from "@hexagons/workflow/use-cases/suggest-next-step.use-case";
import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
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
  PersistenceError,
  type ResolvedModel,
  SystemDateProvider,
} from "@kernel";
import { GhCliAdapter } from "@kernel/infrastructure/gh-cli.adapter";
import { GitHookAdapter } from "@kernel/infrastructure/git-hook/git-hook.adapter";
import { AdvisoryLock } from "@kernel/infrastructure/state-branch/advisory-lock";
import { GitStateBranchOpsAdapter } from "@kernel/infrastructure/state-branch/git-state-branch-ops.adapter";
import { GitStateSyncAdapter } from "@kernel/infrastructure/state-branch/git-state-sync.adapter";
import { StateBranchCreationHandler } from "@kernel/infrastructure/state-branch/state-branch-creation.handler";
import { CrashRecoveryStrategy } from "@kernel/infrastructure/state-recovery/crash-recovery.strategy";
import { FreshCloneStrategy } from "@kernel/infrastructure/state-recovery/fresh-clone.strategy";
import { MismatchRecoveryStrategy } from "@kernel/infrastructure/state-recovery/mismatch-recovery.strategy";
import { RenameRecoveryStrategy } from "@kernel/infrastructure/state-recovery/rename-recovery.strategy";
import { StateRecoveryAdapter } from "@kernel/infrastructure/state-recovery/state-recovery.adapter";
import { GitWorktreeAdapter } from "@kernel/infrastructure/worktree/git-worktree.adapter";
import type { RecoveryStrategy } from "@kernel/ports/recovery-strategy";
import type { RecoveryType } from "@kernel/schemas/recovery.schemas";
import { BackupService } from "@kernel/services/backup-service";
import { ForceSyncUseCase } from "@kernel/services/force-sync.use-case";
import { HealthCheckService } from "@kernel/services/health-check.service";
import { RestoreStateUseCase } from "@kernel/services/restore-state.use-case";
import { StateExporter } from "@kernel/services/state-exporter";
import { StateGuard } from "@kernel/services/state-guard";
import { StateImporter } from "@kernel/services/state-importer";
import type { KnownProvider } from "@mariozechner/pi-ai";
import { getModels, getProviders } from "@mariozechner/pi-ai";
// Auto-mode disabled — will be reimplemented in a future milestone
// import { registerAutoMode } from "./auto-mode";
import { OverlayDataAdapter } from "./infrastructure/overlay-data.adapter";
import { createLazyDatabase } from "./lazy-database";
import { registerOverlayExtension } from "./overlay.extension";
import { TffDispatcher } from "./tff-dispatcher";

/**
 * Resolve model ID from PI's registry by name.
 * Tries exact match, then partial (substring) match.
 * Returns undefined when nothing matches.
 */
function resolveModelFromRegistry(provider: KnownProvider, name: string): string | undefined {
  const models = getModels(provider);
  // Exact match (full model ID like "claude-sonnet-4-6")
  const exact = models.find((m) => m.id === name);
  if (exact) return exact.id;
  // Partial match (short alias like "opus", "sonnet", "haiku")
  const partials = models.filter((m) => m.id.includes(name));
  if (partials.length === 0) return undefined;
  // Prefer non-dated alias over dated snapshot
  const alias = partials.find((m) => !/-\d{8}$/.test(m.id));
  return alias?.id ?? partials[partials.length - 1].id;
}

/**
 * Return PI's default model ID for the given provider.
 * Uses the first model in PI's registry for that provider.
 */
function piDefaultModelId(provider: KnownProvider): string {
  const models = getModels(provider);
  return models[0]?.id ?? "unknown";
}

function detectPlannotator(): string | undefined {
  try {
    return execFileSync("which", ["plannotator"], { encoding: "utf-8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function resolveResourceRoot(packageRoot: string): string {
  const distResources = join(packageRoot, "dist", "resources");
  if (existsSync(distResources)) return distResources;
  return join(packageRoot, "src", "resources");
}

function resolvePackageRoot(): string {
  // Walk up from this file (dist/cli/ or src/cli/) to find the package root
  const thisDir = new URL(".", import.meta.url).pathname;
  let dir = thisDir;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  return thisDir;
}

export interface TffExtensionOptions {
  projectRoot: string;
}

export function createTffExtension(api: ExtensionAPI, options: TffExtensionOptions): void {
  const dispatcher = new TffDispatcher();

  // --- Resource resolution (dist/resources/ for production, src/resources/ for dev) ---
  const packageRoot = resolvePackageRoot();
  const resourceRoot = resolveResourceRoot(packageRoot);

  // --- Shared infrastructure ---
  const logger = new ConsoleLoggerAdapter();
  const eventBus = new InProcessEventBus(logger);
  const dateProvider = new SystemDateProvider();
  const agentEventHub = new InMemoryAgentEventHub();
  const sharedAgentDispatch = new PiAgentDispatchAdapter({ agentEventPort: agentEventHub });

  // --- Agent registry ---
  if (!isAgentRegistryInitialized()) {
    const agentLoader = new AgentResourceLoader();
    const agentRegistryResult = AgentRegistry.loadFromResources(agentLoader, resourceRoot);
    if (!agentRegistryResult.ok) {
      throw new Error(`Failed to load agent registry: ${agentRegistryResult.error.message}`);
    }
    initializeAgentRegistry(agentRegistryResult.data);
  }

  // --- Core infrastructure ---
  const gitPort = new GitCliAdapter(options.projectRoot);

  // --- tffDir resolution ---
  const rootTffDir = join(options.projectRoot, ".tff");
  // Note: .tff/ is NOT created eagerly — tff_init_project creates it.
  // The lazy database defers DB creation until .tff/ exists.
  const worktreeAdapter = new GitWorktreeAdapter(gitPort, options.projectRoot);
  const resolveActiveTffDir = async (sliceId?: string): Promise<string> => {
    if (sliceId && (await worktreeAdapter.exists(sliceId))) {
      return worktreeAdapter.resolveTffDir(sliceId);
    }
    return rootTffDir;
  };

  // --- Shared SQLite database for core entities (lazy — created on first use) ---
  const stateDb = createLazyDatabase(join(rootTffDir, "state.db"));

  // --- Repositories (SQLite-backed) ---
  const projectRepo = new SqliteProjectRepository(stateDb);
  const milestoneRepo = new SqliteMilestoneRepository(stateDb);
  const sliceRepo = new SqliteSliceRepository(stateDb);
  const taskRepo = new SqliteTaskRepository(stateDb);

  // --- Shared infrastructure ---
  const gitHookAdapter = new GitHookAdapter(join(options.projectRoot, ".git"));

  const sliceTransitionPort = new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider);
  const artifactFile = new NodeArtifactFileAdapter(options.projectRoot, resolveActiveTffDir);
  const workflowSessionRepo = new SqliteWorkflowSessionRepository(stateDb);
  const autonomyModeProvider = { getAutonomyMode: () => "plan-to-pr" as const };

  const plannotatorPath = detectPlannotator();
  const reviewUI = plannotatorPath
    ? new PlannotatorReviewUIAdapter(plannotatorPath)
    : new TerminalReviewUIAdapter();

  // --- Shared: modelResolver + templateLoader (needed by execution & review) ---
  const templateLoader = (path: string) => {
    const resolved = resolve(resourceRoot, path);
    if (!resolved.startsWith(resourceRoot)) throw new Error("Path traversal detected");
    return readFileSync(resolved, "utf-8");
  };

  const mergeSettingsForModel = new MergeSettingsUseCase();
  const settingsForModel = mergeSettingsForModel.execute({
    team: null,
    local: null,
    env: process.env,
  });
  const modelProfiles = settingsForModel.ok ? settingsForModel.data.modelRouting.profiles : null;

  const providers = getProviders();
  const defaultProvider = providers[0];
  if (!defaultProvider) {
    throw new Error("No PI providers available. Ensure at least one provider is configured.");
  }
  const modelResolver = (profileName: string): ResolvedModel => {
    const provider = defaultProvider;
    const profile =
      profileName === "quality" || profileName === "balanced" || profileName === "budget"
        ? modelProfiles?.[profileName]
        : undefined;
    const modelName = profile?.model;

    if (!modelName) {
      // No profile configured — use PI's default model for the provider
      return { provider, modelId: piDefaultModelId(provider) };
    }

    const resolved = resolveModelFromRegistry(provider, modelName);
    return { provider, modelId: resolved ?? piDefaultModelId(provider) };
  };

  // --- Execution extension ---
  const journalRepo = new JsonlJournalRepository(join(rootTffDir, "journal"));
  const checkpointRepo = new MarkdownCheckpointRepository(options.projectRoot, async (sliceId) => {
    if (await worktreeAdapter.exists(sliceId)) {
      return { ok: true as const, data: join(".tff", "worktrees", sliceId) };
    }
    return err(new PersistenceError(`No worktree for slice: ${sliceId}`));
  });
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
    [
      new DangerousCommandRule(),
      new CredentialExposureRule(),
      new DestructiveGitRule(),
      new FileScopeRule(),
      new SuspiciousContentRule(),
    ],
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
    new ScopeContainmentRule(),
    new DependencyCheckRule(),
    new ToolPolicyRule(settingsForModel.ok ? settingsForModel.data.toolPolicies : undefined),
    new WorktreeStateRule(worktreeStateGitOps),
    new BudgetCheckRule(),
  ]);
  const executeProtocol = readFileSync(join(resourceRoot, "protocols/execute.md"), "utf-8");

  const executeSlice = new ExecuteSliceUseCase({
    sliceRepo,
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

  // --- Rollback wiring ---
  const phaseTransitionAdapter = {
    async transition(sliceId: string, _from: string, to: string) {
      return sliceTransitionPort.transition(
        sliceId,
        to as import("@hexagons/slice/domain/slice.schemas").SliceStatus,
      );
    },
  };
  const rollbackUseCase = new RollbackSliceUseCase(journalRepo, gitPort, phaseTransitionAdapter);

  registerExecutionExtension(
    dispatcher,
    api,
    {
      sessionRepository: sessionRepo,
      pauseSignal: new ProcessSignalPauseAdapter(),
      executeSlice,
      replayJournal,
      checkpointRepository: checkpointRepo,
      eventBus,
      dateProvider,
      logger,
    },
    {
      rollback: { rollback: rollbackUseCase, checkpointRepo: checkpointRepo, sliceRepo },
      worktreeAdapter,
    },
  );

  // --- Review pipeline wiring ---
  const reviewRepository = new SqliteReviewRepository(stateDb);
  const getSliceExecutors = new GetSliceExecutorsUseCase(checkpointRepo);
  const executorQueryAdapter = new CachedExecutorQueryAdapter(async (sliceId) => {
    const result = await getSliceExecutors.execute(sliceId);
    if (!result.ok)
      return { ok: false as const, error: new ExecutorQueryError(result.error.message) };
    return result;
  });
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
  dispatcher.register({
    name: "verify",
    description: "Verify acceptance criteria for the current slice",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const sliceLabel = args.trim();
      if (!sliceLabel) {
        api.sendUserMessage("Usage: /tff verify <slice-label>");
        return;
      }
      const sliceResult = await sliceRepo.findByLabel(sliceLabel);
      if (!sliceResult.ok || !sliceResult.data) {
        api.sendUserMessage(`Slice not found: ${sliceLabel}`);
        return;
      }
      const result = await verifyUseCase.execute({
        sliceId: sliceResult.data.id,
        workingDirectory: options.projectRoot,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });
      if (!result.ok) {
        api.sendUserMessage(`Verification failed: ${result.error.message}`);
        return;
      }
      api.sendUserMessage(
        `Verification complete: ${result.data.finalVerdict} (${result.data.verifications.length} verification rounds)`,
      );
    },
  });

  dispatcher.register({
    name: "review",
    description:
      "Run code review pipeline on the current slice (spec-reviewer + code-reviewer + security-auditor)",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const sliceLabel = args.trim();
      if (!sliceLabel) {
        api.sendUserMessage("Usage: /tff review <slice-label>");
        return;
      }
      const sliceResult = await sliceRepo.findByLabel(sliceLabel);
      if (!sliceResult.ok || !sliceResult.data) {
        api.sendUserMessage(`Slice not found: ${sliceLabel}`);
        return;
      }
      const result = await conductReviewUseCase.execute({
        sliceId: sliceResult.data.id,
        workingDirectory: options.projectRoot,
        maxFixCycles: 2,
        timeoutMs: 300_000,
      });
      if (!result.ok) {
        api.sendUserMessage(`Review failed: ${result.error.message}`);
        return;
      }
      const verdict = result.data.mergedReview.verdict;
      const findingCount = result.data.mergedReview.findings.length;
      api.sendUserMessage(
        `Review complete: ${verdict} (${findingCount} findings). ${verdict === "approved" ? "Run /tff ship to create the PR." : "Address findings and re-run /tff review."}`,
      );
    },
  });

  // --- State sync wiring (moved before ship/complete for dependency injection) ---
  const ghCliAdapter = new GhCliAdapter(options.projectRoot);
  const mergeGateAdapter = new PiMergeGateAdapter();
  const shipRecordRepository = new SqliteShipRecordRepository(stateDb);
  const completionRecordRepository = new SqliteCompletionRecordRepository(stateDb);

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
    stateBranchOps,
    gitPort,
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
  dispatcher.register({
    name: "ship",
    description: "Ship the current slice — review, create PR, merge gate",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const sliceLabel = args.trim();
      if (!sliceLabel) {
        api.sendUserMessage("Usage: /tff ship <slice-label>");
        return;
      }
      const sliceResult = await sliceRepo.findByLabel(sliceLabel);
      if (!sliceResult.ok || !sliceResult.data) {
        api.sendUserMessage(`Slice not found: ${sliceLabel}`);
        return;
      }
      const milestoneLabel = sliceLabel.replace(/-S\d+$/, "");
      const result = await shipSliceUseCase.execute({
        sliceId: sliceResult.data.id,
        workingDirectory: options.projectRoot,
        baseBranch: `milestone/${milestoneLabel}`,
        headBranch: `slice/${sliceLabel}`,
        maxFixCycles: 2,
      });
      if (!result.ok) {
        api.sendUserMessage(`Ship failed: ${result.error.message}`);
        return;
      }
      api.sendUserMessage(`Ship complete: PR ${result.data.prUrl ?? "created"}`);
    },
  });

  // --- Complete milestone pipeline wiring ---
  const milestoneQueryAdapter = new MilestoneQueryAdapter(
    sliceRepo,
    milestoneRepo,
    options.projectRoot,
  );
  const milestoneTransitionAdapter = new MilestoneTransitionAdapter(milestoneRepo, dateProvider);
  const milestoneAuditRecordRepo = new SqliteMilestoneAuditRecordRepository(stateDb);

  // --- Map codebase use case (shared with CompleteMilestone + /tff map-codebase) ---
  const docWriterAdapter = new PiDocWriterAdapter(
    new PiAgentDispatchAdapter({ agentEventPort: agentEventHub }),
    templateLoader,
    modelResolver,
    logger,
  );
  const mapCodebaseUseCase = new MapCodebaseUseCase(docWriterAdapter, gitPort, logger);

  const completeMilestoneUseCase = new CompleteMilestoneUseCase(
    milestoneQueryAdapter,
    milestoneAuditRecordRepo,
    ghCliAdapter,
    mergeGateAdapter,
    completionRecordRepository,
    gitPort,
    milestoneTransitionAdapter,
    eventBus,
    dateProvider,
    () => crypto.randomUUID(),
    logger,
    gitStateSyncAdapter,
    mapCodebaseUseCase,
  );
  dispatcher.register({
    name: "complete-milestone",
    description: "Complete the active milestone — audit, create PR, merge gate",
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      const project = await projectRepo.findSingleton();
      if (!project.ok || !project.data) {
        api.sendUserMessage("No project found.");
        return;
      }
      const milestones = await milestoneRepo.findByProjectId(project.data.id);
      if (!milestones.ok) {
        api.sendUserMessage("Failed to load milestones.");
        return;
      }
      const active = milestones.data.find((m) => m.status === "in_progress");
      if (!active) {
        api.sendUserMessage("No active milestone found.");
        return;
      }
      const result = await completeMilestoneUseCase.execute({
        milestoneId: active.id,
        milestoneLabel: active.label,
        milestoneTitle: active.title,
        headBranch: `milestone/${active.label}`,
        baseBranch: "main",
        workingDirectory: options.projectRoot,
        maxFixCycles: 2,
      });
      if (!result.ok) {
        api.sendUserMessage(`Milestone completion failed: ${result.error.message}`);
        return;
      }
      api.sendUserMessage(`Milestone ${active.label} completed`);
    },
  });

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
    worktreePort: worktreeAdapter,
    sliceRepo,
    taskRepo,
    journalRepo,
    artifactFile,
  });

  const strategies = new Map<RecoveryType, RecoveryStrategy>([
    ["crash", new CrashRecoveryStrategy(backupService, stateBranchOps, restoreUseCase)],
    ["mismatch", new MismatchRecoveryStrategy(restoreUseCase)],
    ["rename", new RenameRecoveryStrategy(stateBranchOps)],
    [
      "fresh-clone",
      new FreshCloneStrategy(
        backupService,
        stateBranchOps,
        restoreUseCase,
        healthCheckService,
        options.projectRoot,
      ),
    ],
  ]);
  const stateRecoveryAdapter = new StateRecoveryAdapter(
    strategies,
    gitPort,
    stateBranchOps,
    options.projectRoot,
  );
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
  const settingsFileAdapter = new FsSettingsFileAdapter();
  registerProjectExtension(dispatcher, api, {
    projectRoot: options.projectRoot,
    projectRepo,
    projectFs: new NodeProjectFileSystemAdapter(),
    mergeSettings: new MergeSettingsUseCase(),
    eventBus,
    dateProvider,
    gitHookPort: gitHookAdapter,
    discoverStack: new DiscoverStackUseCase(settingsFileAdapter),
    withGuard,
    onBeforeProjectSave: () => (stateDb as ReturnType<typeof createLazyDatabase>).ensureReady(),
    loadPrompt: templateLoader,
  });

  registerMilestoneExtension(dispatcher, api, {
    createMilestone: new CreateMilestoneUseCase(
      projectRepo,
      milestoneRepo,
      eventBus,
      dateProvider,
      options.projectRoot,
    ),
    reviewUI,
    loadPrompt: templateLoader,
  });

  const settingsResolver = new SettingsModelProfileResolver(new MergeSettingsUseCase());
  const contextStaging = new DefaultContextStagingAdapter({
    modelProfileResolver: settingsResolver,
  });
  const workflowJournal = new JsonlWorkflowJournalRepository(
    join(rootTffDir, "workflow-journal.jsonl"),
  );

  registerWorkflowExtension(dispatcher, api, {
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
    tffDir: rootTffDir,
    resolveActiveTffDir,
    withGuard,
    workflowJournal,
    failurePolicies: settingsForModel.ok
      ? settingsForModel.data.workflow.failurePolicies
      : undefined,
    loadPrompt: templateLoader,
    worktreePort: worktreeAdapter,
    stateSyncPort: gitStateSyncAdapter,
  });

  // --- Auto-mode disabled — will be reimplemented in a future milestone ---

  // --- Health command + tool ---
  registerHealthCommand(dispatcher, api, { healthCheck: healthCheckService, tffDir: rootTffDir });
  api.registerTool(createHealthCheckTool({ healthCheck: healthCheckService, tffDir: rootTffDir }));

  // --- Progress command + tool ---
  const getStatusForProgress = new GetStatusUseCase(
    projectRepo,
    milestoneRepo,
    sliceRepo,
    taskRepo,
  );
  registerProgressCommand(dispatcher, api, { getStatus: getStatusForProgress, tffDir: rootTffDir });
  api.registerTool(createProgressTool({ getStatus: getStatusForProgress }));

  // --- Settings command + tools ---
  const loadSettings = new LoadSettingsUseCase(
    new FsSettingsFileAdapter(),
    new ProcessEnvVarAdapter(),
  );
  const mergeSettingsForSettings = new MergeSettingsUseCase();
  const formatCascade = new FormatSettingsCascadeService();
  registerSettingsCommand(dispatcher, api, {
    loadSettings,
    mergeSettings: mergeSettingsForSettings,
    formatCascade,
    projectRoot: options.projectRoot,
  });
  api.registerTool(
    createReadSettingsTool({
      loadSettings,
      mergeSettings: mergeSettingsForSettings,
      formatCascade,
      projectRoot: options.projectRoot,
    }),
  );
  api.registerTool(createUpdateSettingTool({ projectRoot: options.projectRoot }));

  // --- Help + repair commands ---
  registerHelpCommand(dispatcher, api);
  registerRepairBranchesCommand(dispatcher, api, {
    projectRepo,
    milestoneRepo,
    projectRoot: options.projectRoot,
  });

  // --- /tff sync command ---
  dispatcher.register({
    name: "sync",
    description: "Force-push or force-pull state to/from state branch",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const guardResult = await stateGuard.ensure(rootTffDir);
      if (!guardResult.ok) {
        api.sendUserMessage(`State guard failed: ${guardResult.error.message}`);
        return;
      }
      const isPull = args.trim() === "--pull";
      if (isPull) {
        const pullResult = await forceSyncUseCase.pull(rootTffDir);
        api.sendUserMessage(
          pullResult.ok
            ? `Pulled state from state branch (${pullResult.data.filesRestored} files restored)`
            : `Pull failed: ${pullResult.error.message}`,
        );
      } else {
        const pushResult = await forceSyncUseCase.push(rootTffDir);
        api.sendUserMessage(
          pushResult.ok
            ? "State pushed to state branch"
            : `Push failed: ${pushResult.error.message}`,
        );
      }
    },
  });

  // --- S09: Slice management commands ---
  const addSliceUseCase = new AddSliceUseCase(sliceRepo, milestoneRepo, dateProvider, eventBus);
  const removeSliceUseCase = new RemoveSliceUseCase(
    sliceRepo,
    worktreeAdapter,
    stateBranchOps,
    gitPort,
    milestoneRepo,
    rootTffDir,
  );

  registerAddSliceCommand(dispatcher, api, {
    addSlice: addSliceUseCase,
    activeMilestoneId: async () => {
      const project = await projectRepo.findSingleton();
      if (!project.ok || !project.data) return null;
      const milestones = await milestoneRepo.findByProjectId(project.data.id);
      if (!milestones.ok) return null;
      const active = milestones.data.find((m) => m.status === "in_progress");
      return active?.id ?? null;
    },
  });
  api.registerTool(createAddSliceTool({ addSlice: addSliceUseCase, tffDir: rootTffDir }));

  registerRemoveSliceCommand(dispatcher, api, { removeSlice: removeSliceUseCase });
  api.registerTool(createRemoveSliceTool({ removeSlice: removeSliceUseCase }));

  // --- S09: Audit milestone ---
  const piAuditAdapter = new PiAuditAdapter(
    new PiAgentDispatchAdapter({ agentEventPort: agentEventHub }),
    templateLoader,
    modelResolver,
    logger,
  );
  const auditMilestoneUseCase = new AuditMilestoneUseCase(
    milestoneQueryAdapter,
    piAuditAdapter,
    milestoneAuditRecordRepo,
    gitPort,
    dateProvider,
    () => crypto.randomUUID(),
  );
  registerAuditMilestoneCommand(dispatcher, api, {
    auditMilestone: auditMilestoneUseCase,
    resolveActiveMilestone: async () => {
      const project = await projectRepo.findSingleton();
      if (!project.ok || !project.data) return null;
      const milestones = await milestoneRepo.findByProjectId(project.data.id);
      if (!milestones.ok) return null;
      const active = milestones.data.find((m) => m.status === "in_progress");
      if (!active) return null;
      return {
        milestoneId: active.id,
        milestoneLabel: active.label,
        headBranch: `milestone/${active.label}`,
        baseBranch: "main",
        workingDirectory: options.projectRoot,
      };
    },
  });
  api.registerTool(createAuditMilestoneTool({ auditMilestone: auditMilestoneUseCase }));

  // --- S09: Map codebase ---
  registerMapCodebaseCommand(dispatcher, api, {
    mapCodebase: mapCodebaseUseCase,
    tffDir: rootTffDir,
    workingDirectory: options.projectRoot,
  });
  api.registerTool(createMapCodebaseTool({ mapCodebase: mapCodebaseUseCase }));

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

  const budgetTrackingPort = new LoggingBudgetAdapter(logger);
  registerOverlayExtension(dispatcher, api, {
    overlayDataPort: overlayDataAdapter,
    budgetTrackingPort,
    eventBus,
    agentEventPort: agentEventHub,
    hotkeys,
    logger,
  });

  // --- Mount the single /tff dispatcher command ---
  dispatcher.mount(api);
}

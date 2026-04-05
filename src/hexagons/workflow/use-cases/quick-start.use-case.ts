import type { AutonomyMode } from "@hexagons/settings";
import type { SliceRepositoryPort } from "@hexagons/slice";
import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import type { SliceKind } from "@hexagons/slice/domain/slice-kind.schemas";
import {
  type ComplexityTier,
  type DateProviderPort,
  type EventBusPort,
  err,
  isErr,
  ok,
  PersistenceError,
  type Result,
  type SyncError,
  type WorktreeError,
} from "@kernel";
import type { StateSyncPort } from "@kernel/ports/state-sync.port";
import type { WorktreePort } from "@kernel/ports/worktree.port";
import type { WorkflowBaseError } from "../domain/errors/workflow-base.error";
import type { AutonomyModeProvider } from "../domain/ports/autonomy-mode.provider";
import type { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import { WorkflowSession } from "../domain/workflow-session.aggregate";
import type { WorkflowPhase } from "../domain/workflow-session.schemas";
import type {
  OrchestratePhaseTransitionUseCase,
  WorkflowSessionNotFoundError,
} from "./orchestrate-phase-transition.use-case";

export interface QuickStartInput {
  title: string;
  description: string;
  kind?: SliceKind;
  complexity?: ComplexityTier;
  tffDir: string;
}

export interface QuickStartOutput {
  sliceId: string;
  sliceLabel: string;
  sessionId: string;
  currentPhase: WorkflowPhase;
  autonomyMode: AutonomyMode;
  complexity: ComplexityTier;
}

type QuickStartError =
  | WorkflowBaseError
  | WorkflowSessionNotFoundError
  | PersistenceError
  | WorktreeError
  | SyncError;

export class QuickStartUseCase {
  constructor(
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly sessionRepo: WorkflowSessionRepositoryPort,
    private readonly orchestratePhaseTransition: OrchestratePhaseTransitionUseCase,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
    private readonly autonomyModeProvider: AutonomyModeProvider,
    private readonly worktreePort?: WorktreePort,
    private readonly stateSyncPort?: StateSyncPort,
  ) {}

  async execute(input: QuickStartInput): Promise<Result<QuickStartOutput, QuickStartError>> {
    const kind: SliceKind = input.kind ?? "quick";
    const complexity: ComplexityTier = input.complexity ?? "S";
    const now = this.dateProvider.now();
    const autonomyMode = this.autonomyModeProvider.getAutonomyMode();

    // 1. Auto-generate label
    const labelResult = await this.generateLabel(kind);
    if (isErr(labelResult)) return labelResult;
    const label = labelResult.data;

    // 2. Create slice (no milestoneId for ad-hoc)
    const slice = Slice.createNew({
      id: crypto.randomUUID(),
      milestoneId: undefined,
      kind,
      label,
      title: input.title,
      description: input.description,
      now,
    });

    // Set complexity on the slice
    slice.setComplexity(complexity, now);

    // 3. Save slice
    const sliceSaveResult = await this.sliceRepo.save(slice);
    if (isErr(sliceSaveResult)) return sliceSaveResult;

    // 4. Create workspace (if ports available)
    if (this.worktreePort && this.stateSyncPort) {
      const codeBranch = `${kind}/${label}`;
      const wsResult = await this.createWorkspace(
        label,
        codeBranch,
        this.worktreePort,
        this.stateSyncPort,
      );
      if (isErr(wsResult)) return wsResult;
    }

    // 5. Create WorkflowSession with null milestoneId
    const session = WorkflowSession.createNew({
      id: crypto.randomUUID(),
      milestoneId: null,
      autonomyMode,
      now,
    });

    // 6. Assign slice + trigger start
    const assignResult = session.assignSlice(slice.id);
    if (isErr(assignResult)) return assignResult;

    const guardContext = {
      complexityTier: complexity,
      retryCount: 0,
      maxRetries: 2,
      allSlicesClosed: false,
      lastError: null,
      failurePolicy: "strict" as const,
    };

    const startResult = session.trigger("start", guardContext, now);
    if (isErr(startResult)) return startResult;

    // 7. Save session
    const sessionSaveResult = await this.sessionRepo.save(session);
    if (isErr(sessionSaveResult)) return sessionSaveResult;

    // 8. Publish events from session
    for (const event of session.pullEvents()) {
      await this.eventBus.publish(event);
    }

    // 9. Skip discuss → planning
    const skipResult = await this.orchestratePhaseTransition.execute({
      sliceId: slice.id,
      trigger: "skip",
      guardContext,
    });
    if (isErr(skipResult)) return skipResult;

    // 10. Conditionally auto-approve (S-tier + plan-to-pr)
    if (complexity === "S" && autonomyMode === "plan-to-pr") {
      const approveResult = await this.orchestratePhaseTransition.execute({
        sliceId: slice.id,
        trigger: "approve",
        guardContext,
      });
      if (isErr(approveResult)) return approveResult;
    }

    // 11. Load fresh session to get current phase
    const reloadResult = await this.sessionRepo.findBySliceId(slice.id);
    if (isErr(reloadResult)) return reloadResult;
    if (!reloadResult.data) {
      return err(new PersistenceError(`Session not found for slice '${slice.id}'`));
    }
    const currentPhase = reloadResult.data.currentPhase;

    return ok({
      sliceId: slice.id,
      sliceLabel: label,
      sessionId: session.id,
      currentPhase,
      autonomyMode,
      complexity,
    });
  }

  private async generateLabel(kind: SliceKind): Promise<Result<string, PersistenceError>> {
    const findResult = await this.sliceRepo.findByKind(kind);
    if (isErr(findResult)) return findResult;

    const prefix = kind === "debug" ? "D" : "Q";
    const existing = findResult.data;

    let maxNum = 0;
    for (const slice of existing) {
      const match = slice.label.match(/^[QD]-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }

    const next = maxNum + 1;
    const padded = String(next).padStart(2, "0");
    return ok(`${prefix}-${padded}`);
  }

  private async createWorkspace(
    label: string,
    codeBranch: string,
    worktreePort: WorktreePort,
    stateSyncPort: StateSyncPort,
  ): Promise<Result<void, WorktreeError | SyncError>> {
    const wtResult = await worktreePort.create(label, "main");
    if (!wtResult.ok) return err(wtResult.error);

    const sbResult = await stateSyncPort.createStateBranch(codeBranch, "tff-state/main");
    if (!sbResult.ok) {
      await worktreePort.delete(label);
      return err(sbResult.error);
    }

    return ok(undefined);
  }
}

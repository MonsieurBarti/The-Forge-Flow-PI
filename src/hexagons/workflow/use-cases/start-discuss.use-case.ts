import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { SliceRepositoryPort } from "@hexagons/slice";
import { SliceNotFoundError } from "@hexagons/slice";
import {
  type DateProviderPort,
  type EventBusPort,
  err,
  isErr,
  ok,
  PersistenceError,
  type Result,
  type SyncError,
} from "@kernel";
import type { WorktreeError } from "@kernel/errors/worktree.error";
import type { StateSyncPort } from "@kernel/ports/state-sync.port";
import type { WorktreePort } from "@kernel/ports/worktree.port";
import type { WorkflowBaseError } from "../domain/errors/workflow-base.error";
import type { AutonomyModeProvider } from "../domain/ports/autonomy-mode.provider";
import type { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import { WorkflowSession } from "../domain/workflow-session.aggregate";

export interface StartDiscussInput {
  sliceId: string;
  milestoneId: string;
  tffDir: string;
}

export interface StartDiscussOutput {
  sessionId: string;
  fromPhase: string;
  toPhase: string;
  autonomyMode: string;
}

type StartDiscussError =
  | SliceNotFoundError
  | WorkflowBaseError
  | PersistenceError
  | WorktreeError
  | SyncError;

export class StartDiscussUseCase {
  constructor(
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly sessionRepo: WorkflowSessionRepositoryPort,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
    private readonly autonomyModeProvider: AutonomyModeProvider,
    private readonly worktreePort?: WorktreePort,
    private readonly stateSyncPort?: StateSyncPort,
    private readonly milestoneRepo?: MilestoneRepositoryPort,
  ) {}

  async execute(input: StartDiscussInput): Promise<Result<StartDiscussOutput, StartDiscussError>> {
    // 1. Validate slice exists
    const sliceResult = await this.sliceRepo.findById(input.sliceId);
    if (isErr(sliceResult)) return sliceResult;
    if (!sliceResult.data) return err(new SliceNotFoundError(input.sliceId));

    // 2. Workspace creation (if ports available)
    if (this.worktreePort && this.stateSyncPort && this.milestoneRepo) {
      const sliceMilestoneId = sliceResult.data.milestoneId;
      if (sliceMilestoneId) {
        const wsResult = await this.createWorkspace(input, sliceMilestoneId);
        if (isErr(wsResult)) return wsResult;
      }
    }

    // 3. Find or create session
    const sessionResult = await this.sessionRepo.findByMilestoneId(input.milestoneId);
    if (isErr(sessionResult)) return sessionResult;

    const now = this.dateProvider.now();
    let session = sessionResult.data;
    if (!session) {
      session = WorkflowSession.createNew({
        id: crypto.randomUUID(),
        milestoneId: input.milestoneId,
        autonomyMode: this.autonomyModeProvider.getAutonomyMode(),
        now,
      });
    }

    // 4. Assign slice (skip if already assigned to this slice — idempotent retry)
    const fromPhase = session.currentPhase;
    if (session.sliceId !== input.sliceId) {
      const assignResult = session.assignSlice(input.sliceId);
      if (isErr(assignResult)) return assignResult;
    }

    // 5. Trigger start transition (skip if already discussing — idempotent retry)
    if (session.currentPhase !== "discussing") {
      const triggerResult = session.trigger(
        "start",
        {
          complexityTier: null,
          retryCount: 0,
          maxRetries: 2,
          allSlicesClosed: false,
          lastError: null,
          failurePolicy: "strict",
        },
        now,
      );
      if (isErr(triggerResult)) return triggerResult;
    }

    // 6. Save session
    const saveResult = await this.sessionRepo.save(session);
    if (isErr(saveResult)) return saveResult;

    // 7. Publish events
    for (const event of session.pullEvents()) {
      await this.eventBus.publish(event);
    }

    return ok({
      sessionId: session.id,
      fromPhase,
      toPhase: session.currentPhase,
      autonomyMode: session.autonomyMode,
    });
  }

  private async createWorkspace(
    input: StartDiscussInput,
    milestoneId: string,
  ): Promise<Result<void, StartDiscussError>> {
    if (!this.worktreePort || !this.stateSyncPort || !this.milestoneRepo) {
      return err(new PersistenceError("Required ports not available for workspace creation"));
    }
    const worktreePort = this.worktreePort;
    const stateSyncPort = this.stateSyncPort;
    const milestoneRepo = this.milestoneRepo;

    // Load milestone to derive branch names
    const msResult = await milestoneRepo.findById(milestoneId);
    if (isErr(msResult)) return msResult;
    if (!msResult.data) {
      return err(new PersistenceError(`Milestone not found: ${milestoneId}`));
    }
    const msLabel = msResult.data.label;
    const baseBranch = `milestone/${msLabel}`;
    const sliceCodeBranch = `slice/${input.sliceId}`;
    const parentStateBranch = `tff-state/${baseBranch}`;

    // 3a. Create worktree (skip if already exists — idempotent retry)
    const worktreeExists = await worktreePort.exists(input.sliceId);
    if (!worktreeExists) {
      const wtResult = await worktreePort.create(input.sliceId, baseBranch);
      if (!wtResult.ok) return err(wtResult.error);
    }

    // 3b. Create state branch (ignore "already exists" errors — idempotent retry)
    const sbResult = await stateSyncPort.createStateBranch(sliceCodeBranch, parentStateBranch);
    if (!sbResult.ok) {
      const isAlreadyExists =
        sbResult.error.message.includes("already exists") ||
        sbResult.error.message.includes("already a branch");
      if (!isAlreadyExists) {
        if (!worktreeExists) await worktreePort.delete(input.sliceId);
        return err(sbResult.error);
      }
    }

    // 3c. Initialize workspace (skip if worktree already existed — already initialized)
    if (worktreeExists) {
      return ok(undefined);
    }
    const now = this.dateProvider.now();
    const branchMeta = {
      version: 1,
      stateId: crypto.randomUUID(),
      codeBranch: sliceCodeBranch,
      stateBranch: `tff-state/${sliceCodeBranch}`,
      parentStateBranch,
      lastSyncedAt: now,
      lastJournalOffset: 0,
      dirty: false,
      lastSyncedHash: null,
    };
    const wsResult = await worktreePort.initializeWorkspace(
      input.sliceId,
      input.tffDir,
      branchMeta,
    );
    if (!wsResult.ok) {
      // Rollback: delete state branch and worktree
      await stateSyncPort.deleteStateBranch(sliceCodeBranch);
      await worktreePort.delete(input.sliceId);
      return err(wsResult.error);
    }

    return ok(undefined);
  }
}

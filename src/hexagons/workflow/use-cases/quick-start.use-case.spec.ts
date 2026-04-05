import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { WorkflowSliceTransitionAdapter } from "@hexagons/slice/infrastructure/workflow-slice-transition.adapter";
import {
  DateProviderPort,
  err,
  InMemoryWorktreeAdapter,
  InProcessEventBus,
  isOk,
  ok,
  type Result,
  SilentLoggerAdapter,
  SyncError,
} from "@kernel";
import { StateSyncPort } from "@kernel/ports/state-sync.port";
import type { SyncReport } from "@kernel/ports/state-sync.schemas";
import { describe, expect, it } from "vitest";
import { InMemoryWorkflowSessionRepository } from "../infrastructure/in-memory-workflow-session.repository";
import { OrchestratePhaseTransitionUseCase } from "./orchestrate-phase-transition.use-case";
import { QuickStartUseCase } from "./quick-start.use-case";

class StubStateSyncPort extends StateSyncPort {
  createCalls: Array<{ codeBranch: string; parent: string }> = [];
  shouldFailCreate = false;

  async syncToStateBranch(): Promise<Result<void, SyncError>> {
    return ok(undefined);
  }
  async restoreFromStateBranch(): Promise<Result<SyncReport, SyncError>> {
    return ok({ pulled: 0, conflicts: [], timestamp: new Date() });
  }
  async mergeStateBranches(): Promise<Result<void, SyncError>> {
    return ok(undefined);
  }
  async createStateBranch(codeBranch: string, parent: string): Promise<Result<void, SyncError>> {
    this.createCalls.push({ codeBranch, parent });
    if (this.shouldFailCreate) {
      return err(new SyncError("BRANCH_NOT_FOUND", "parent branch not found"));
    }
    return ok(undefined);
  }
  async deleteStateBranch(): Promise<Result<void, SyncError>> {
    return ok(undefined);
  }
}

class StubDateProvider extends DateProviderPort {
  private _now = new Date("2026-04-05T12:00:00Z");
  now(): Date {
    return this._now;
  }
}

function setup(overrides?: { autonomyMode?: "guided" | "plan-to-pr"; withWorkspace?: boolean }) {
  const sliceRepo = new InMemorySliceRepository();
  const sessionRepo = new InMemoryWorkflowSessionRepository();
  const eventBus = new InProcessEventBus(new SilentLoggerAdapter());
  const dateProvider = new StubDateProvider();
  const autonomyModeProvider = {
    getAutonomyMode: () => overrides?.autonomyMode ?? ("plan-to-pr" as const),
  };
  const sliceTransitionPort = new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider);
  const orchestratePhaseTransition = new OrchestratePhaseTransitionUseCase(
    sessionRepo,
    sliceTransitionPort,
    eventBus,
    dateProvider,
  );
  const worktreeAdapter = new InMemoryWorktreeAdapter();
  const stateSyncPort = new StubStateSyncPort();

  const useCase = overrides?.withWorkspace
    ? new QuickStartUseCase(
        sliceRepo,
        sessionRepo,
        orchestratePhaseTransition,
        eventBus,
        dateProvider,
        autonomyModeProvider,
        worktreeAdapter,
        stateSyncPort,
      )
    : new QuickStartUseCase(
        sliceRepo,
        sessionRepo,
        orchestratePhaseTransition,
        eventBus,
        dateProvider,
        autonomyModeProvider,
      );

  return {
    useCase,
    sliceRepo,
    sessionRepo,
    eventBus,
    dateProvider,
    worktreeAdapter,
    stateSyncPort,
  };
}

describe("QuickStartUseCase", () => {
  it("creates quick slice with auto-generated label Q-01", async () => {
    const { useCase, sliceRepo } = setup();

    const result = await useCase.execute({
      title: "Fix login bug",
      description: "Something is broken",
      tffDir: "/tmp/.tff",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.sliceLabel).toBe("Q-01");
      expect(result.data.sliceId).toBeTruthy();
    }

    const kindResult = await sliceRepo.findByKind("quick");
    expect(isOk(kindResult)).toBe(true);
    if (isOk(kindResult)) expect(kindResult.data).toHaveLength(1);
  });

  it("increments label for subsequent quick slices", async () => {
    const { useCase } = setup();

    await useCase.execute({
      title: "First quick",
      description: "",
      tffDir: "/tmp/.tff",
    });

    const result = await useCase.execute({
      title: "Second quick",
      description: "",
      tffDir: "/tmp/.tff",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.sliceLabel).toBe("Q-02");
    }
  });

  it("creates debug slice with D-01 label", async () => {
    const { useCase } = setup();

    const result = await useCase.execute({
      title: "Debug auth flow",
      description: "Tracing auth",
      kind: "debug",
      tffDir: "/tmp/.tff",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.sliceLabel).toBe("D-01");
    }
  });

  it("creates slice with null milestoneId", async () => {
    const { useCase, sliceRepo } = setup();

    const result = await useCase.execute({
      title: "Ad-hoc task",
      description: "",
      tffDir: "/tmp/.tff",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const sliceResult = await sliceRepo.findById(result.data.sliceId);
      expect(isOk(sliceResult)).toBe(true);
      if (isOk(sliceResult) && sliceResult.data) {
        expect(sliceResult.data.milestoneId).toBeNull();
      }
    }
  });

  it("transitions to planning for F-full complexity", async () => {
    const { useCase } = setup({ autonomyMode: "plan-to-pr" });

    const result = await useCase.execute({
      title: "Complex task",
      description: "",
      complexity: "F-full",
      tffDir: "/tmp/.tff",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.currentPhase).toBe("planning");
    }
  });

  it("transitions to executing for S-tier + plan-to-pr", async () => {
    const { useCase } = setup({ autonomyMode: "plan-to-pr" });

    const result = await useCase.execute({
      title: "Simple task",
      description: "",
      complexity: "S",
      tffDir: "/tmp/.tff",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.currentPhase).toBe("executing");
    }
  });

  it("stops at planning for S-tier + guided", async () => {
    const { useCase } = setup({ autonomyMode: "guided" });

    const result = await useCase.execute({
      title: "Simple guided task",
      description: "",
      complexity: "S",
      tffDir: "/tmp/.tff",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.currentPhase).toBe("planning");
    }
  });

  it("creates worktree with base branch main", async () => {
    const { useCase, worktreeAdapter } = setup({ withWorkspace: true });

    const result = await useCase.execute({
      title: "Quick fix",
      description: "",
      tffDir: "/tmp/.tff",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const label = result.data.sliceLabel;
      expect(await worktreeAdapter.exists(label)).toBe(true);
    }
  });

  it("creates state branch with correct naming", async () => {
    const { useCase, stateSyncPort } = setup({ withWorkspace: true });

    await useCase.execute({
      title: "Quick fix",
      description: "",
      tffDir: "/tmp/.tff",
    });

    expect(stateSyncPort.createCalls).toHaveLength(1);
    expect(stateSyncPort.createCalls[0]).toEqual({
      codeBranch: "quick/Q-01",
      parent: "tff-state/main",
    });
  });
});

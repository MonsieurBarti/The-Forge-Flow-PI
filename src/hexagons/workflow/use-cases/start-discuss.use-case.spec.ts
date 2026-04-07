import { MilestoneBuilder } from "@hexagons/milestone/domain/milestone.builder";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import {
  err,
  InProcessEventBus,
  isErr,
  isOk,
  ok,
  type Result,
  SilentLoggerAdapter,
  SyncError,
} from "@kernel";
import { InMemoryWorktreeAdapter } from "@kernel/infrastructure/worktree/in-memory-worktree.adapter";
import { StateSyncPort } from "@kernel/ports/state-sync.port";
import type { SyncReport } from "@kernel/ports/state-sync.schemas";
import { describe, expect, it } from "vitest";
import { WorkflowSession } from "../domain/workflow-session.aggregate";
import { WorkflowSessionBuilder } from "../domain/workflow-session.builder";
import { InMemoryWorkflowSessionRepository } from "../infrastructure/in-memory-workflow-session.repository";
import { StartDiscussUseCase } from "./start-discuss.use-case";

class StubStateSyncPort extends StateSyncPort {
  createCalls: Array<{ codeBranch: string; parent: string }> = [];
  deleteCalls: string[] = [];
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
  async deleteStateBranch(codeBranch: string): Promise<Result<void, SyncError>> {
    this.deleteCalls.push(codeBranch);
    return ok(undefined);
  }
}

function setup(overrides?: { autonomyMode?: "guided" | "plan-to-pr"; withWorkspace?: boolean }) {
  const sliceRepo = new InMemorySliceRepository();
  const sessionRepo = new InMemoryWorkflowSessionRepository();
  const eventBus = new InProcessEventBus(new SilentLoggerAdapter());
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const autonomyModeProvider = {
    getAutonomyMode: () => overrides?.autonomyMode ?? ("plan-to-pr" as const),
  };

  const worktreeAdapter = new InMemoryWorktreeAdapter();
  const stateSyncPort = new StubStateSyncPort();
  const milestoneRepo = new InMemoryMilestoneRepository();

  const useCase = overrides?.withWorkspace
    ? new StartDiscussUseCase(
        sliceRepo,
        sessionRepo,
        eventBus,
        dateProvider,
        autonomyModeProvider,
        worktreeAdapter,
        stateSyncPort,
        milestoneRepo,
      )
    : new StartDiscussUseCase(sliceRepo, sessionRepo, eventBus, dateProvider, autonomyModeProvider);
  return {
    useCase,
    sliceRepo,
    sessionRepo,
    eventBus,
    dateProvider,
    fixedNow,
    worktreeAdapter,
    stateSyncPort,
    milestoneRepo,
  };
}

describe("StartDiscussUseCase", () => {
  it("should create a new session, assign slice, and transition to discussing", async () => {
    const { useCase, sliceRepo } = setup();
    const slice = new SliceBuilder().withId("a0000000-0000-1000-a000-000000000001").build();
    sliceRepo.seed(slice);

    const result = await useCase.execute({
      sliceId: "a0000000-0000-1000-a000-000000000001",
      milestoneId: "b0000000-0000-1000-a000-000000000001",
      tffDir: "/tmp/.tff",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.fromPhase).toBe("idle");
      expect(result.data.toPhase).toBe("discussing");
      expect(result.data.autonomyMode).toBe("plan-to-pr");
    }
  });

  it("should reuse existing session for the milestone", async () => {
    const { useCase, sliceRepo, sessionRepo } = setup();
    const slice = new SliceBuilder().withId("a0000000-0000-1000-a000-000000000002").build();
    sliceRepo.seed(slice);
    const existingSession = WorkflowSession.createNew({
      id: "c0000000-0000-1000-a000-000000000001",
      milestoneId: "b0000000-0000-1000-a000-000000000001",
      autonomyMode: "plan-to-pr",
      now: new Date(),
    });
    sessionRepo.seed(existingSession);

    const result = await useCase.execute({
      sliceId: "a0000000-0000-1000-a000-000000000002",
      milestoneId: "b0000000-0000-1000-a000-000000000001",
      tffDir: "/tmp/.tff",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data.sessionId).toBe("c0000000-0000-1000-a000-000000000001");
  });

  it("should return error if slice does not exist", async () => {
    const { useCase } = setup();
    const result = await useCase.execute({
      sliceId: "a0000000-0000-1000-a000-000000000099",
      milestoneId: "b0000000-0000-1000-a000-000000000001",
      tffDir: "/tmp/.tff",
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("SLICE.NOT_FOUND");
  });

  it("should return SliceAlreadyAssignedError if session has active slice", async () => {
    const { useCase, sliceRepo, sessionRepo } = setup();
    const slice1 = new SliceBuilder().withId("a0000000-0000-1000-a000-000000000003").build();
    const slice2 = new SliceBuilder()
      .withId("a0000000-0000-1000-a000-000000000004")
      .withLabel("M01-S02")
      .build();
    sliceRepo.seed(slice1);
    sliceRepo.seed(slice2);
    const session = WorkflowSession.createNew({
      id: "c0000000-0000-1000-a000-000000000002",
      milestoneId: "b0000000-0000-1000-a000-000000000002",
      autonomyMode: "plan-to-pr",
      now: new Date(),
    });
    session.assignSlice("a0000000-0000-1000-a000-000000000003");
    sessionRepo.seed(session);

    const result = await useCase.execute({
      sliceId: "a0000000-0000-1000-a000-000000000004",
      milestoneId: "b0000000-0000-1000-a000-000000000002",
      tffDir: "/tmp/.tff",
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("WORKFLOW.SLICE_ALREADY_ASSIGNED");
  });

  it("should succeed idempotently if session already discussing", async () => {
    const { useCase, sliceRepo, sessionRepo } = setup();
    const slice = new SliceBuilder().withId("a0000000-0000-1000-a000-000000000005").build();
    sliceRepo.seed(slice);
    const session = WorkflowSession.reconstitute(
      new WorkflowSessionBuilder()
        .withId("c0000000-0000-1000-a000-000000000003")
        .withMilestoneId("b0000000-0000-1000-a000-000000000003")
        .withCurrentPhase("discussing")
        .buildProps(),
    );
    sessionRepo.seed(session);

    const result = await useCase.execute({
      sliceId: "a0000000-0000-1000-a000-000000000005",
      milestoneId: "b0000000-0000-1000-a000-000000000003",
      tffDir: "/tmp/.tff",
    });
    expect(isOk(result)).toBe(true);
  });

  describe("workspace creation", () => {
    it("creates worktree + state branch + workspace when ports provided", async () => {
      const { useCase, sliceRepo, worktreeAdapter, stateSyncPort, milestoneRepo } = setup({
        withWorkspace: true,
      });
      const slice = new SliceBuilder()
        .withId("a0000000-0000-1000-a000-000000000010")
        .withMilestoneId("b0000000-0000-1000-a000-000000000010")
        .build();
      sliceRepo.seed(slice);
      const milestone = new MilestoneBuilder()
        .withId("b0000000-0000-1000-a000-000000000010")
        .withLabel("M07")
        .build();
      milestoneRepo.seed(milestone);

      const result = await useCase.execute({
        sliceId: "a0000000-0000-1000-a000-000000000010",
        milestoneId: "b0000000-0000-1000-a000-000000000010",
        tffDir: "/tmp/.tff",
      });

      expect(isOk(result)).toBe(true);
      expect(await worktreeAdapter.exists("a0000000-0000-1000-a000-000000000010")).toBe(true);
      expect(stateSyncPort.createCalls).toHaveLength(1);
    });

    it("rolls back worktree if state branch creation fails", async () => {
      const { useCase, sliceRepo, worktreeAdapter, stateSyncPort, milestoneRepo } = setup({
        withWorkspace: true,
      });
      const slice = new SliceBuilder()
        .withId("a0000000-0000-1000-a000-000000000011")
        .withMilestoneId("b0000000-0000-1000-a000-000000000011")
        .build();
      sliceRepo.seed(slice);
      const milestone = new MilestoneBuilder()
        .withId("b0000000-0000-1000-a000-000000000011")
        .withLabel("M07")
        .build();
      milestoneRepo.seed(milestone);
      stateSyncPort.shouldFailCreate = true;

      const result = await useCase.execute({
        sliceId: "a0000000-0000-1000-a000-000000000011",
        milestoneId: "b0000000-0000-1000-a000-000000000011",
        tffDir: "/tmp/.tff",
      });

      expect(isErr(result)).toBe(true);
      // Worktree should be cleaned up
      expect(await worktreeAdapter.exists("a0000000-0000-1000-a000-000000000011")).toBe(false);
    });
  });
});

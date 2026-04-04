import {
  DateProviderPort,
  err,
  InProcessEventBus,
  ok,
  type Result,
  SilentLoggerAdapter,
} from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { Checkpoint } from "../domain/checkpoint.aggregate";
import { ExecutionError } from "../domain/errors/execution.error";
import { JournalReplayError } from "../domain/errors/journal-replay.error";
import { ExecutionSession } from "../domain/execution-session.aggregate";
import { InMemoryCheckpointRepository } from "../infrastructure/repositories/checkpoint/in-memory-checkpoint.repository";
import { InMemoryExecutionSessionAdapter } from "../infrastructure/adapters/execution-session/in-memory-execution-session.adapter";
import { InMemoryPauseSignalAdapter } from "../infrastructure/adapters/pause-signal/in-memory-pause-signal.adapter";
import type { ExecuteSliceInput, ExecuteSliceResult } from "./execute-slice.schemas";
import type { StartExecutionInput } from "./execution-coordinator.schemas";
import {
  ExecutionCoordinator,
  type ExecutionCoordinatorDeps,
} from "./execution-coordinator.use-case";
import type { ReplayResult } from "./replay-journal.use-case";

// ---------------------------------------------------------------------------
// StubDateProvider
// ---------------------------------------------------------------------------
class StubDateProvider extends DateProviderPort {
  private date = new Date("2026-03-30T12:00:00Z");
  now(): Date {
    return this.date;
  }
  advance(ms: number): void {
    this.date = new Date(this.date.getTime() + ms);
  }
}

// ---------------------------------------------------------------------------
// Stub ExecuteSliceUseCase
// ---------------------------------------------------------------------------
class StubExecuteSlice {
  private resultFn: (
    input: ExecuteSliceInput,
    signal?: AbortSignal,
  ) => Promise<Result<ExecuteSliceResult, ExecutionError>> = async () =>
    ok({
      sliceId: SLICE_ID,
      completedTasks: [],
      failedTasks: [],
      skippedTasks: [],
      wavesCompleted: 1,
      totalWaves: 1,
      aborted: false,
    });

  givenResult(
    fn: (
      input: ExecuteSliceInput,
      signal?: AbortSignal,
    ) => Promise<Result<ExecuteSliceResult, ExecutionError>>,
  ): void {
    this.resultFn = fn;
  }

  async execute(
    input: ExecuteSliceInput,
    signal?: AbortSignal,
  ): Promise<Result<ExecuteSliceResult, ExecutionError>> {
    return this.resultFn(input, signal);
  }
}

// ---------------------------------------------------------------------------
// Stub ReplayJournalUseCase
// ---------------------------------------------------------------------------
class StubReplayJournal {
  private result: Result<ReplayResult, JournalReplayError> = ok({
    resumeFromWave: 0,
    completedTaskIds: [],
    lastProcessedSeq: -1,
    consistent: true,
  });

  givenResult(result: Result<ReplayResult, JournalReplayError>): void {
    this.result = result;
  }

  async execute(_input: unknown): Promise<Result<ReplayResult, JournalReplayError>> {
    return this.result;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SLICE_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const MILESTONE_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeInput(overrides?: Partial<StartExecutionInput>): StartExecutionInput {
  return {
    sliceId: SLICE_ID,
    milestoneId: MILESTONE_ID,
    sliceLabel: "S10",
    sliceTitle: "Coordinator wiring",
    complexity: "F-lite",
    model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
    modelProfile: "balanced",
    workingDirectory: "/mock/worktree",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("ExecutionCoordinator", () => {
  let sessionRepo: InMemoryExecutionSessionAdapter;
  let pauseSignal: InMemoryPauseSignalAdapter;
  let stubExecuteSlice: StubExecuteSlice;
  let stubReplayJournal: StubReplayJournal;
  let checkpointRepo: InMemoryCheckpointRepository;
  let eventBus: InProcessEventBus;
  let dateProvider: StubDateProvider;
  let logger: SilentLoggerAdapter;
  let coordinator: ExecutionCoordinator;

  beforeEach(() => {
    sessionRepo = new InMemoryExecutionSessionAdapter();
    pauseSignal = new InMemoryPauseSignalAdapter();
    stubExecuteSlice = new StubExecuteSlice();
    stubReplayJournal = new StubReplayJournal();
    checkpointRepo = new InMemoryCheckpointRepository();
    logger = new SilentLoggerAdapter();
    eventBus = new InProcessEventBus(logger);
    dateProvider = new StubDateProvider();

    const deps: ExecutionCoordinatorDeps = {
      sessionRepository: sessionRepo,
      pauseSignal,
      executeSlice: stubExecuteSlice,
      replayJournal: stubReplayJournal,
      checkpointRepository: checkpointRepo,
      eventBus,
      dateProvider,
      logger,
    };

    coordinator = new ExecutionCoordinator(deps);
  });

  // -------------------------------------------------------------------------
  // startExecution
  // -------------------------------------------------------------------------
  describe("startExecution", () => {
    it("creates session, calls execute, returns completed on success", async () => {
      const result = await coordinator.startExecution(makeInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe("completed");
        expect(result.data.sliceId).toBe(SLICE_ID);
      }
      // Session should be saved
      const sessionResult = await sessionRepo.findBySliceId(SLICE_ID);
      expect(sessionResult.ok).toBe(true);
      if (sessionResult.ok && sessionResult.data) {
        expect(sessionResult.data.status).toBe("completed");
      }
    });

    it("returns failed when execution errors", async () => {
      stubExecuteSlice.givenResult(async () => err(ExecutionError.noTasks(SLICE_ID)));
      const result = await coordinator.startExecution(makeInput());
      expect(result.ok).toBe(false);
    });

    it("returns paused when signal aborted between waves", async () => {
      stubExecuteSlice.givenResult(async () => {
        // Simulate: pause requested during execution
        pauseSignal.triggerPause();
        return ok({
          sliceId: SLICE_ID,
          completedTasks: ["task-1"],
          failedTasks: [],
          skippedTasks: [],
          wavesCompleted: 1,
          totalWaves: 3,
          aborted: true,
        });
      });
      const result = await coordinator.startExecution(makeInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe("paused");
        expect(result.data.wavesCompleted).toBe(1);
      }
    });

    it("rejects if paused session exists", async () => {
      const session = ExecutionSession.createNew({
        id: crypto.randomUUID(),
        sliceId: SLICE_ID,
        milestoneId: MILESTONE_ID,
        now: new Date(),
      });
      session.start(new Date());
      session.confirmPause(new Date());
      sessionRepo.seed(session);

      const result = await coordinator.startExecution(makeInput());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("paused");
      }
    });

    it("rejects if running session exists", async () => {
      const session = ExecutionSession.createNew({
        id: crypto.randomUUID(),
        sliceId: SLICE_ID,
        milestoneId: MILESTONE_ID,
        now: new Date(),
      });
      session.start(new Date());
      sessionRepo.seed(session);

      const result = await coordinator.startExecution(makeInput());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("running");
      }
    });

    it("allows start after failed session", async () => {
      const session = ExecutionSession.createNew({
        id: crypto.randomUUID(),
        sliceId: SLICE_ID,
        milestoneId: MILESTONE_ID,
        now: new Date(),
      });
      session.start(new Date());
      session.fail("prev failure", new Date());
      sessionRepo.seed(session);

      const result = await coordinator.startExecution(makeInput());
      expect(result.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // pauseExecution
  // -------------------------------------------------------------------------
  describe("pauseExecution", () => {
    it("transitions orphaned running session to paused (post-crash)", async () => {
      const session = ExecutionSession.createNew({
        id: crypto.randomUUID(),
        sliceId: SLICE_ID,
        milestoneId: MILESTONE_ID,
        now: new Date(),
      });
      session.start(new Date());
      sessionRepo.seed(session);

      const result = await coordinator.pauseExecution(SLICE_ID);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.status).toBe("paused");

      const saved = await sessionRepo.findBySliceId(SLICE_ID);
      if (saved.ok && saved.data) expect(saved.data.status).toBe("paused");
    });

    it("no-ops for already paused session", async () => {
      const session = ExecutionSession.createNew({
        id: crypto.randomUUID(),
        sliceId: SLICE_ID,
        milestoneId: MILESTONE_ID,
        now: new Date(),
      });
      session.start(new Date());
      session.confirmPause(new Date());
      sessionRepo.seed(session);

      const result = await coordinator.pauseExecution(SLICE_ID);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.status).toBe("paused");
    });

    it("errors when no session found", async () => {
      const result = await coordinator.pauseExecution(SLICE_ID);
      expect(result.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // resumeExecution
  // -------------------------------------------------------------------------
  describe("resumeExecution", () => {
    it("validates journal, resumes session, calls execute", async () => {
      const session = ExecutionSession.createNew({
        id: crypto.randomUUID(),
        sliceId: SLICE_ID,
        milestoneId: MILESTONE_ID,
        now: new Date(),
      });
      session.start(new Date());
      session.confirmPause(new Date());
      sessionRepo.seed(session);

      const result = await coordinator.resumeExecution(SLICE_ID, makeInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe("completed");
      }
    });

    it("fails session on journal inconsistency", async () => {
      const session = ExecutionSession.createNew({
        id: crypto.randomUUID(),
        sliceId: SLICE_ID,
        milestoneId: MILESTONE_ID,
        now: new Date(),
      });
      session.start(new Date());
      session.confirmPause(new Date());
      sessionRepo.seed(session);

      stubReplayJournal.givenResult(err(new JournalReplayError("Checkpoint/journal mismatch")));

      // Need a checkpoint for journal validation
      const cp = Checkpoint.createNew({
        id: crypto.randomUUID(),
        sliceId: SLICE_ID,
        baseCommit: "abc",
        now: new Date(),
      });
      checkpointRepo.seed(cp);

      const result = await coordinator.resumeExecution(SLICE_ID, makeInput());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Journal inconsistency");
      }
    });

    it("creates synthetic session when only checkpoint exists (crash recovery)", async () => {
      // No session, but checkpoint exists
      const cp = Checkpoint.createNew({
        id: crypto.randomUUID(),
        sliceId: SLICE_ID,
        baseCommit: "abc",
        now: new Date(),
      });
      checkpointRepo.seed(cp);

      const result = await coordinator.resumeExecution(SLICE_ID, makeInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe("completed");
      }
    });

    it("rejects if session is not paused", async () => {
      const session = ExecutionSession.createNew({
        id: crypto.randomUUID(),
        sliceId: SLICE_ID,
        milestoneId: MILESTONE_ID,
        now: new Date(),
      });
      session.start(new Date());
      session.fail("prev error", new Date());
      sessionRepo.seed(session);

      const result = await coordinator.resumeExecution(SLICE_ID, makeInput());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("failed");
      }
    });
  });
});

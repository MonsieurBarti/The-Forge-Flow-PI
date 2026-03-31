import { DetectWavesUseCase } from "@hexagons/task/domain/detect-waves.use-case";
import { Task } from "@hexagons/task/domain/task.aggregate";
import { TaskBuilder } from "@hexagons/task/domain/task.builder";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import {
  DateProviderPort,
  type DomainEvent,
  EVENT_NAMES,
  InMemoryGitAdapter,
  InProcessEventBus,
  ok,
  SilentLoggerAdapter,
} from "@kernel";
import { AgentResultBuilder, isSuccessfulStatus } from "@kernel/agents";
import { beforeEach, describe, expect, it } from "vitest";
import { Checkpoint } from "../domain/checkpoint.aggregate";
import { AllTasksCompletedEvent } from "../domain/events/all-tasks-completed.event";
import { TaskExecutionCompletedEvent } from "../domain/events/task-execution-completed.event";
import type { OverseerConfig } from "../domain/overseer.schemas";
import { DefaultRetryPolicy } from "../infrastructure/default-retry-policy";
import { InMemoryAgentDispatchAdapter } from "../infrastructure/in-memory-agent-dispatch.adapter";
import { InMemoryCheckpointRepository } from "../infrastructure/in-memory-checkpoint.repository";
import { InMemoryGuardrailAdapter } from "../infrastructure/in-memory-guardrail.adapter";
import { InMemoryJournalRepository } from "../infrastructure/in-memory-journal.repository";
import { InMemoryMetricsRepository } from "../infrastructure/in-memory-metrics.repository";
import { InMemoryOverseerAdapter } from "../infrastructure/in-memory-overseer.adapter";
import { InMemoryWorktreeAdapter } from "../infrastructure/in-memory-worktree.adapter";
import type { ExecuteSliceInput } from "./execute-slice.schemas";
import { ExecuteSliceUseCase } from "./execute-slice.use-case";

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
// Constants
// ---------------------------------------------------------------------------
const SLICE_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const MILESTONE_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const T1_ID = "10000001-0000-4000-a000-000000000001";
const T2_ID = "20000002-0000-4000-a000-000000000002";
const T3_ID = "30000003-0000-4000-a000-000000000003";
const CP_ID = "c0000001-0000-4000-a000-000000000001";
const TEMPLATE_CONTENT = "Execute {{taskLabel}} — {{taskTitle}} in {{workingDirectory}}";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeInput(overrides?: Partial<ExecuteSliceInput>): ExecuteSliceInput {
  return {
    sliceId: SLICE_ID,
    milestoneId: MILESTONE_ID,
    sliceLabel: "S07",
    sliceTitle: "Execution engine",
    complexity: "F-lite",
    model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
    modelProfile: "balanced",
    workingDirectory: "/mock/worktree",
    ...overrides,
  };
}

function makeTask(id: string, label: string, blockedBy: string[] = []) {
  const props = new TaskBuilder()
    .withId(id)
    .withSliceId(SLICE_ID)
    .withLabel(label)
    .withTitle(`Task ${label}`)
    .withDescription(`Desc for ${label}`)
    .withAcceptanceCriteria(`AC for ${label}`)
    .withFilePaths([`src/${label}.ts`])
    .withBlockedBy(blockedBy)
    .buildProps();
  return Task.reconstitute(props);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("ExecuteSliceUseCase", () => {
  let taskRepo: InMemoryTaskRepository;
  let waveDetection: DetectWavesUseCase;
  let checkpointRepo: InMemoryCheckpointRepository;
  let agentDispatch: InMemoryAgentDispatchAdapter;
  let worktreeAdapter: InMemoryWorktreeAdapter;
  let eventBus: InProcessEventBus;
  let journalRepo: InMemoryJournalRepository;
  let metricsRepo: InMemoryMetricsRepository;
  let dateProvider: StubDateProvider;
  let logger: SilentLoggerAdapter;
  let guardrailAdapter: InMemoryGuardrailAdapter;
  let mockGitPort: InMemoryGitAdapter;
  let overseerAdapter: InMemoryOverseerAdapter;
  let retryPolicy: DefaultRetryPolicy;
  const OVERSEER_CONFIG: OverseerConfig = {
    enabled: true,
    timeouts: { S: 300000, "F-lite": 900000, "F-full": 1800000 },
    retryLoop: { threshold: 3 },
  };
  let useCase: ExecuteSliceUseCase;

  beforeEach(() => {
    taskRepo = new InMemoryTaskRepository();
    waveDetection = new DetectWavesUseCase();
    checkpointRepo = new InMemoryCheckpointRepository();
    agentDispatch = new InMemoryAgentDispatchAdapter();
    worktreeAdapter = new InMemoryWorktreeAdapter();
    eventBus = new InProcessEventBus(new SilentLoggerAdapter());
    journalRepo = new InMemoryJournalRepository();
    metricsRepo = new InMemoryMetricsRepository();
    dateProvider = new StubDateProvider();
    logger = new SilentLoggerAdapter();
    guardrailAdapter = new InMemoryGuardrailAdapter();
    mockGitPort = new InMemoryGitAdapter();
    overseerAdapter = new InMemoryOverseerAdapter();
    retryPolicy = new DefaultRetryPolicy(2, 3);

    // Seed worktree for non-S tier by default
    worktreeAdapter.seed({
      sliceId: SLICE_ID,
      branch: `slice/${SLICE_ID}`,
      path: `/mock/.tff/worktrees/${SLICE_ID}`,
      baseBranch: "main",
    });

    useCase = new ExecuteSliceUseCase({
      taskRepository: taskRepo,
      waveDetection,
      checkpointRepository: checkpointRepo,
      agentDispatch,
      worktree: worktreeAdapter,
      eventBus,
      journalRepository: journalRepo,
      metricsRepository: metricsRepo,
      dateProvider,
      logger,
      templateContent: TEMPLATE_CONTENT,
      guardrail: guardrailAdapter,
      gitPort: mockGitPort,
      overseer: overseerAdapter,
      retryPolicy,
      overseerConfig: OVERSEER_CONFIG,
    });
  });

  // -------------------------------------------------------------------------
  // 1. dispatches wave 0 tasks in parallel via Promise.allSettled (AC1)
  // -------------------------------------------------------------------------
  it("dispatches wave 0 tasks in parallel via Promise.allSettled (AC1)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    const t2 = makeTask(T2_ID, "T02");
    taskRepo.seed(t1);
    taskRepo.seed(t2);

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );
    agentDispatch.givenResult(
      T2_ID,
      ok(new AgentResultBuilder().withTaskId(T2_ID).asDone().build()),
    );

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(agentDispatch.wasDispatched(T1_ID)).toBe(true);
    expect(agentDispatch.wasDispatched(T2_ID)).toBe(true);
    expect(result.data.completedTasks).toContain(T1_ID);
    expect(result.data.completedTasks).toContain(T2_ID);
  });

  // -------------------------------------------------------------------------
  // 2. executes waves sequentially — wave 1 waits for wave 0 (AC1)
  // -------------------------------------------------------------------------
  it("executes waves sequentially — wave 1 waits for wave 0 (AC1)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    const t2 = makeTask(T2_ID, "T02", [T1_ID]);
    taskRepo.seed(t1);
    taskRepo.seed(t2);

    const dispatchOrder: string[] = [];
    const originalDispatch = agentDispatch.dispatch.bind(agentDispatch);
    agentDispatch.dispatch = async (config) => {
      dispatchOrder.push(config.taskId);
      return originalDispatch(config);
    };

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );
    agentDispatch.givenResult(
      T2_ID,
      ok(new AgentResultBuilder().withTaskId(T2_ID).asDone().build()),
    );

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // T01 dispatched in wave 0, T02 dispatched in wave 1
    expect(dispatchOrder.indexOf(T1_ID)).toBeLessThan(dispatchOrder.indexOf(T2_ID));
    expect(result.data.wavesCompleted).toBe(2);
    expect(result.data.totalWaves).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 3. skips completed waves on resume from checkpoint (AC2)
  // -------------------------------------------------------------------------
  it("skips completed waves on resume from checkpoint (AC2)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    const t2 = makeTask(T2_ID, "T02", [T1_ID]);
    taskRepo.seed(t1);
    taskRepo.seed(t2);

    // Seed a checkpoint where wave 0 is completed
    const checkpoint = Checkpoint.reconstitute({
      version: 1,
      id: CP_ID,
      sliceId: SLICE_ID,
      baseCommit: "abc",
      currentWaveIndex: 1,
      completedWaves: [0],
      completedTasks: [T1_ID],
      executorLog: [
        {
          taskId: T1_ID,
          agentIdentity: "executor",
          startedAt: new Date("2026-03-30T11:00:00Z"),
          completedAt: new Date("2026-03-30T11:30:00Z"),
        },
      ],
      createdAt: new Date("2026-03-30T11:00:00Z"),
      updatedAt: new Date("2026-03-30T11:30:00Z"),
    });
    checkpointRepo.seed(checkpoint);

    agentDispatch.givenResult(
      T2_ID,
      ok(new AgentResultBuilder().withTaskId(T2_ID).asDone().build()),
    );

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // T01 should NOT be dispatched (wave 0 skipped)
    expect(agentDispatch.wasDispatched(T1_ID)).toBe(false);
    // T02 should be dispatched (wave 1)
    expect(agentDispatch.wasDispatched(T2_ID)).toBe(true);
    expect(result.data.completedTasks).toContain(T2_ID);
  });

  // -------------------------------------------------------------------------
  // 4. skips completed tasks within current wave on resume (AC2)
  // -------------------------------------------------------------------------
  it("skips completed tasks within current wave on resume (AC2)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    const t2 = makeTask(T2_ID, "T02");
    taskRepo.seed(t1);
    taskRepo.seed(t2);

    // Seed checkpoint where wave 0 is in progress, T01 already completed
    const checkpoint = Checkpoint.reconstitute({
      version: 1,
      id: CP_ID,
      sliceId: SLICE_ID,
      baseCommit: "abc",
      currentWaveIndex: 0,
      completedWaves: [],
      completedTasks: [T1_ID],
      executorLog: [
        {
          taskId: T1_ID,
          agentIdentity: "executor",
          startedAt: new Date("2026-03-30T11:00:00Z"),
          completedAt: new Date("2026-03-30T11:30:00Z"),
        },
      ],
      createdAt: new Date("2026-03-30T11:00:00Z"),
      updatedAt: new Date("2026-03-30T11:30:00Z"),
    });
    checkpointRepo.seed(checkpoint);

    agentDispatch.givenResult(
      T2_ID,
      ok(new AgentResultBuilder().withTaskId(T2_ID).asDone().build()),
    );

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // T01 should NOT be dispatched (already completed in checkpoint)
    expect(agentDispatch.wasDispatched(T1_ID)).toBe(false);
    // T02 should be dispatched
    expect(agentDispatch.wasDispatched(T2_ID)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. aborts on task failure — in-flight complete, no further waves (AC3)
  // -------------------------------------------------------------------------
  it("aborts on task failure — in-flight complete, ¬further waves (AC3)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    const t2 = makeTask(T2_ID, "T02");
    const t3 = makeTask(T3_ID, "T03", [T1_ID, T2_ID]);
    taskRepo.seed(t1);
    taskRepo.seed(t2);
    taskRepo.seed(t3);

    // T01 succeeds, T02 fails
    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );
    agentDispatch.givenResult(
      T2_ID,
      ok(new AgentResultBuilder().withTaskId(T2_ID).asBlocked("Missing dep").build()),
    );

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.aborted).toBe(true);
    expect(result.data.failedTasks).toContain(T2_ID);
    // T03 should NOT be dispatched (wave 1 never started)
    expect(agentDispatch.wasDispatched(T3_ID)).toBe(false);
    expect(result.data.wavesCompleted).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 5a. publishes TaskCompletedEvent to EventBus on success (AC5)
  // -------------------------------------------------------------------------
  it("publishes TaskCompletedEvent to EventBus on success (AC5)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );

    const events: DomainEvent[] = [];
    eventBus.subscribe(EVENT_NAMES.TASK_COMPLETED, async (e) => {
      events.push(e);
    });

    await useCase.execute(makeInput());

    expect(events.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 5b. publishes TaskBlockedEvent to EventBus on failure (AC5)
  // -------------------------------------------------------------------------
  it("publishes TaskBlockedEvent to EventBus on failure (AC5)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asBlocked("Missing dep").build()),
    );

    const events: DomainEvent[] = [];
    eventBus.subscribe(EVENT_NAMES.TASK_BLOCKED, async (e) => {
      events.push(e);
    });

    await useCase.execute(makeInput());

    expect(events.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 6. emits TaskExecutionCompletedEvent on success (AC5)
  // -------------------------------------------------------------------------
  it("emits TaskExecutionCompletedEvent on success (AC5)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );

    const events: DomainEvent[] = [];
    eventBus.subscribe(EVENT_NAMES.TASK_EXECUTION_COMPLETED, async (e) => {
      events.push(e);
    });

    await useCase.execute(makeInput());

    expect(events.length).toBeGreaterThanOrEqual(1);
    const ev = events[0];
    expect(ev).toBeInstanceOf(TaskExecutionCompletedEvent);
    if (ev instanceof TaskExecutionCompletedEvent) {
      expect(ev.taskId).toBe(T1_ID);
      expect(ev.sliceId).toBe(SLICE_ID);
      expect(isSuccessfulStatus(ev.agentResult.status)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 7. emits TaskExecutionCompletedEvent on failure (AC5)
  // -------------------------------------------------------------------------
  it("emits TaskExecutionCompletedEvent on failure (AC5)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asBlocked("Missing dep").build()),
    );

    const events: DomainEvent[] = [];
    eventBus.subscribe(EVENT_NAMES.TASK_EXECUTION_COMPLETED, async (e) => {
      events.push(e);
    });

    await useCase.execute(makeInput());

    expect(events.length).toBeGreaterThanOrEqual(1);
    const ev = events[0];
    expect(ev).toBeInstanceOf(TaskExecutionCompletedEvent);
    if (ev instanceof TaskExecutionCompletedEvent) {
      expect(ev.taskId).toBe(T1_ID);
      expect(isSuccessfulStatus(ev.agentResult.status)).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // 8. emits AllTasksCompletedEvent when all waves complete (AC6)
  // -------------------------------------------------------------------------
  it("emits AllTasksCompletedEvent when all waves complete (AC6)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );

    const events: DomainEvent[] = [];
    eventBus.subscribe(EVENT_NAMES.ALL_TASKS_COMPLETED, async (e) => {
      events.push(e);
    });

    await useCase.execute(makeInput());

    expect(events.length).toBe(1);
    const ev = events[0];
    expect(ev).toBeInstanceOf(AllTasksCompletedEvent);
    if (ev instanceof AllTasksCompletedEvent) {
      expect(ev.sliceId).toBe(SLICE_ID);
      expect(ev.completedTaskCount).toBe(1);
      expect(ev.totalWaveCount).toBe(1);
    }
  });

  // -------------------------------------------------------------------------
  // 9. does NOT emit AllTasksCompletedEvent when aborted (AC6)
  // -------------------------------------------------------------------------
  it("does NOT emit AllTasksCompletedEvent when aborted (AC6)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asBlocked("err").build()),
    );

    const events: DomainEvent[] = [];
    eventBus.subscribe(EVENT_NAMES.ALL_TASKS_COMPLETED, async (e) => {
      events.push(e);
    });

    await useCase.execute(makeInput());

    expect(events.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 10. detects stale claims and collects in skippedTasks (AC7)
  // -------------------------------------------------------------------------
  it("detects stale claims and collects in skippedTasks (AC7)", async () => {
    // Create a task that's currently in_progress with an old updatedAt
    const t1 = makeTask(T1_ID, "T01");
    // Start it to transition to in_progress
    t1.start(new Date("2026-03-30T10:00:00Z"));
    taskRepo.seed(t1);

    // dateProvider is at 12:00, so t1 updatedAt 10:00 means 2 hours stale (> 30 min)
    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.skippedTasks).toContain(T1_ID);
    // Stale task should NOT be dispatched
    expect(agentDispatch.wasDispatched(T1_ID)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 11. wires JournalEventHandler before dispatch (AC8)
  // -------------------------------------------------------------------------
  it("wires JournalEventHandler before dispatch (AC8)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );

    await useCase.execute(makeInput());

    // Verify journal has entries (from CheckpointSavedEvent propagated via JournalEventHandler)
    const journalResult = await journalRepo.readAll(SLICE_ID);
    expect(journalResult.ok).toBe(true);
    if (!journalResult.ok) return;
    expect(journalResult.data.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 12. returns worktreeRequired error for non-S complexity without worktree (AC9)
  // -------------------------------------------------------------------------
  it("returns worktreeRequired error for non-S complexity without worktree (AC9)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    // Reset worktree so it doesn't exist
    worktreeAdapter.reset();

    const result = await useCase.execute(makeInput({ complexity: "F-lite" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EXECUTION.WORKTREE_REQUIRED");
  });

  // -------------------------------------------------------------------------
  // 13. saves checkpoint after each task completion (AC10)
  // -------------------------------------------------------------------------
  it("saves checkpoint after each task completion (AC10)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    const t2 = makeTask(T2_ID, "T02");
    taskRepo.seed(t1);
    taskRepo.seed(t2);

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );
    agentDispatch.givenResult(
      T2_ID,
      ok(new AgentResultBuilder().withTaskId(T2_ID).asDone().build()),
    );

    await useCase.execute(makeInput());

    const cpResult = await checkpointRepo.findBySliceId(SLICE_ID);
    expect(cpResult.ok).toBe(true);
    if (!cpResult.ok) return;
    const cp = cpResult.data;
    expect(cp).not.toBeNull();
    if (!cp) return;
    expect(cp.completedTasks).toContain(T1_ID);
    expect(cp.completedTasks).toContain(T2_ID);
  });

  // -------------------------------------------------------------------------
  // 14. returns noTasks error for empty slice
  // -------------------------------------------------------------------------
  it("returns noTasks error for empty slice", async () => {
    // No tasks seeded
    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EXECUTION.NO_TASKS");
  });

  // -------------------------------------------------------------------------
  // 15. returns cyclicDependency error for cyclic deps
  // -------------------------------------------------------------------------
  it("returns cyclicDependency error for cyclic deps", async () => {
    const t1 = makeTask(T1_ID, "T01", [T2_ID]);
    const t2 = makeTask(T2_ID, "T02", [T1_ID]);
    taskRepo.seed(t1);
    taskRepo.seed(t2);

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EXECUTION.CYCLIC_DEPENDENCY");
  });

  // -------------------------------------------------------------------------
  // 16. S-tier complexity requires a worktree (AC9 applies to all tiers)
  // -------------------------------------------------------------------------
  it("returns worktreeRequired error for S-tier complexity without worktree (AC9)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    // Reset worktree so it doesn't exist
    worktreeAdapter.reset();

    const result = await useCase.execute(makeInput({ complexity: "S" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EXECUTION.WORKTREE_REQUIRED");
  });

  // -------------------------------------------------------------------------
  // Guardrail validation
  // -------------------------------------------------------------------------
  describe("guardrail validation", () => {
    it("blocks wave when guardrail returns error violations", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);

      agentDispatch.givenResult(
        T1_ID,
        ok(
          new AgentResultBuilder()
            .withTaskId(T1_ID)
            .asDone()
            .withFilesChanged(["src/T01.ts"])
            .build(),
        ),
      );

      guardrailAdapter.givenReport({
        violations: [
          { ruleId: "dangerous-commands", severity: "error", message: "rm -rf detected" },
        ],
        passed: false,
        summary: "1 error",
      });

      const result = await useCase.execute(makeInput());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.failedTasks).toContain(T1_ID);
      expect(result.data.aborted).toBe(true);
    });

    it("proceeds with warnings attached as concerns", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);

      agentDispatch.givenResult(
        T1_ID,
        ok(
          new AgentResultBuilder()
            .withTaskId(T1_ID)
            .asDone()
            .withFilesChanged(["src/T01.ts"])
            .build(),
        ),
      );

      guardrailAdapter.givenReport({
        violations: [{ ruleId: "file-scope", severity: "warning", message: "File outside scope" }],
        passed: true,
        summary: "1 warning",
      });

      const result = await useCase.execute(makeInput());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.completedTasks).toContain(T1_ID);
      expect(result.data.aborted).toBe(false);
    });

    it("runs guardrails for S-tier complexity", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);

      // Worktree must exist for S-tier (guardrails apply to all tiers)
      // beforeEach already seeds the worktree

      agentDispatch.givenResult(
        T1_ID,
        ok(
          new AgentResultBuilder()
            .withTaskId(T1_ID)
            .asDone()
            .withFilesChanged(["src/T01.ts"])
            .build(),
        ),
      );

      guardrailAdapter.givenReport({
        violations: [
          { ruleId: "dangerous-commands", severity: "error", message: "rm -rf detected" },
        ],
        passed: false,
        summary: "1 error",
      });

      const result = await useCase.execute(makeInput({ complexity: "S" }));

      expect(guardrailAdapter.wasValidated()).toBe(true);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.aborted).toBe(true);
      expect(result.data.failedTasks).toContain(T1_ID);
    });

    it("journals guardrail-violation entries on block", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);

      agentDispatch.givenResult(
        T1_ID,
        ok(
          new AgentResultBuilder()
            .withTaskId(T1_ID)
            .asDone()
            .withFilesChanged(["src/T01.ts"])
            .build(),
        ),
      );

      guardrailAdapter.givenReport({
        violations: [
          { ruleId: "credential-exposure", severity: "error", message: "API key found" },
        ],
        passed: false,
        summary: "1 error",
      });

      await useCase.execute(makeInput());

      const journalResult = await journalRepo.readAll(SLICE_ID);
      expect(journalResult.ok).toBe(true);
      if (!journalResult.ok) return;

      const guardrailEntries = journalResult.data.filter((e) => e.type === "guardrail-violation");
      expect(guardrailEntries.length).toBeGreaterThanOrEqual(1);
      const entry = guardrailEntries[0];
      if (entry?.type !== "guardrail-violation") return;
      expect(entry.action).toBe("blocked");
      expect(entry.taskId).toBe(T1_ID);
    });

    it("reverts worktree when guardrail blocks", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);

      agentDispatch.givenResult(
        T1_ID,
        ok(
          new AgentResultBuilder()
            .withTaskId(T1_ID)
            .asDone()
            .withFilesChanged(["src/T01.ts"])
            .build(),
        ),
      );

      guardrailAdapter.givenReport({
        violations: [
          { ruleId: "destructive-git", severity: "error", message: "Force push detected" },
        ],
        passed: false,
        summary: "1 error",
      });

      await useCase.execute(makeInput());

      expect(mockGitPort.restoreWorktreeCalls).toContain("/mock/worktree");
    });
  });

  // -----------------------------------------------------------------------
  // Overseer integration
  // -----------------------------------------------------------------------
  describe("overseer integration", () => {
    it("does not monitor when overseer disabled (AC5)", async () => {
      const disabledConfig: OverseerConfig = { ...OVERSEER_CONFIG, enabled: false };
      useCase = new ExecuteSliceUseCase({
        taskRepository: taskRepo,
        waveDetection,
        checkpointRepository: checkpointRepo,
        agentDispatch,
        worktree: worktreeAdapter,
        eventBus,
        journalRepository: journalRepo,
        metricsRepository: metricsRepo,
        dateProvider,
        logger,
        templateContent: TEMPLATE_CONTENT,
        guardrail: guardrailAdapter,
        gitPort: mockGitPort,
        overseer: overseerAdapter,
        retryPolicy,
        overseerConfig: disabledConfig,
      });

      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);
      agentDispatch.givenResult(
        T1_ID,
        ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
      );

      const result = await useCase.execute(makeInput());

      expect(result.ok).toBe(true);
      expect(overseerAdapter.monitorCalls.length).toBe(0);
    });

    it("successful dispatch stops overseer monitor without intervention", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);
      agentDispatch.givenResult(
        T1_ID,
        ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
      );

      const result = await useCase.execute(makeInput());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.completedTasks).toContain(T1_ID);

      // Verify overseer was started (monitor called)
      expect(overseerAdapter.monitorCalls.length).toBe(1);

      // No intervention journal entries
      const journalResult = await journalRepo.readAll(SLICE_ID);
      if (!journalResult.ok) return;
      const interventions = journalResult.data.filter((e) => e.type === "overseer-intervention");
      expect(interventions.length).toBe(0);
    });

    it("stale-claim detection still works with overseer enabled (AC6)", async () => {
      const t1 = makeTask(T1_ID, "T01");
      t1.start(new Date("2026-03-30T10:00:00Z"));
      taskRepo.seed(t1);

      const result = await useCase.execute(makeInput());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.skippedTasks).toContain(T1_ID);
      expect(agentDispatch.wasDispatched(T1_ID)).toBe(false);
      // Overseer should NOT be called for skipped tasks
      expect(overseerAdapter.monitorCalls.length).toBe(0);
    });
  });
});

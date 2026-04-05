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
  type Result,
  SilentLoggerAdapter,
} from "@kernel";
import type { AgentDispatchError } from "@kernel/agents";
import {
  type AgentDispatchConfig,
  type AgentResult,
  AgentResultBuilder,
  isSuccessfulStatus,
} from "@kernel/agents";
import { beforeEach, describe, expect, it } from "vitest";
import { Checkpoint } from "../domain/checkpoint.aggregate";
import { AllTasksCompletedEvent } from "../domain/events/all-tasks-completed.event";
import { TaskExecutionCompletedEvent } from "../domain/events/task-execution-completed.event";
import type { OverseerConfig } from "../domain/overseer.schemas";
import { DefaultRetryPolicy } from "../infrastructure/policies/default-retry-policy";
import { InMemoryAgentDispatchAdapter } from "../infrastructure/adapters/agent-dispatch/in-memory-agent-dispatch.adapter";
import { InMemoryCheckpointRepository } from "../infrastructure/repositories/checkpoint/in-memory-checkpoint.repository";
import { InMemoryGuardrailAdapter } from "../infrastructure/adapters/guardrails/in-memory-guardrail.adapter";
import { InMemoryJournalRepository } from "../infrastructure/repositories/journal/in-memory-journal.repository";
import { InMemoryMetricsRepository } from "../infrastructure/repositories/metrics/in-memory-metrics.repository";
import { InMemoryOverseerAdapter } from "../infrastructure/adapters/overseer/in-memory-overseer.adapter";
import { InMemoryPreDispatchAdapter } from "../infrastructure/adapters/pre-dispatch/in-memory-pre-dispatch.adapter";
import { InMemoryWorktreeAdapter } from "@kernel/infrastructure/worktree/in-memory-worktree.adapter";
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
  let preDispatchAdapter: InMemoryPreDispatchAdapter;
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
    preDispatchAdapter = new InMemoryPreDispatchAdapter();
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
      preDispatchGuardrail: preDispatchAdapter,
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
  // 5. collects per-task failures without aborting (AC3)
  // -------------------------------------------------------------------------
  it("collects per-task failures — succeeding sibling completes, wave advances (AC3)", async () => {
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
    agentDispatch.givenResult(
      T3_ID,
      ok(new AgentResultBuilder().withTaskId(T3_ID).asDone().build()),
    );

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No longer aborts on per-task failure
    expect(result.data.failedTasks).toContain(T2_ID);
    expect(result.data.completedTasks).toContain(T1_ID);
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
  // 9. does NOT emit AllTasksCompletedEvent when aborted via signal (AC6)
  // -------------------------------------------------------------------------
  it("does NOT emit AllTasksCompletedEvent when aborted via signal (AC6)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    const t2 = makeTask(T2_ID, "T02", [T1_ID]);
    taskRepo.seed(t1);
    taskRepo.seed(t2);

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );

    const controller = new AbortController();
    const originalDispatch = agentDispatch.dispatch.bind(agentDispatch);
    let dispatchCount = 0;
    agentDispatch.dispatch = async (cfg: AgentDispatchConfig) => {
      dispatchCount++;
      const result = await originalDispatch(cfg);
      if (dispatchCount === 1) controller.abort();
      return result;
    };

    const events: DomainEvent[] = [];
    eventBus.subscribe(EVENT_NAMES.ALL_TASKS_COMPLETED, async (e) => {
      events.push(e);
    });

    await useCase.execute(makeInput(), controller.signal);

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
    it("collects guardrail blocker as failed task without aborting", async () => {
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
        preDispatchGuardrail: preDispatchAdapter,
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

    it("full intervention lifecycle: timeout → abort → journal → retry → success (AC1,AC3,AC4)", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);

      // Override dispatch: first call never resolves (overseer will win), second succeeds
      const capturedConfigs: AgentDispatchConfig[] = [];
      let dispatchCall = 0;
      agentDispatch.dispatch = async (
        config: AgentDispatchConfig,
      ): Promise<Result<AgentResult, AgentDispatchError>> => {
        capturedConfigs.push(config);
        dispatchCall++;
        if (dispatchCall === 1) {
          // First attempt: never resolves — overseer will trigger timeout
          return new Promise<Result<AgentResult, AgentDispatchError>>(() => {});
        }
        // Second attempt (retry): succeeds immediately
        return ok(new AgentResultBuilder().withTaskId(config.taskId).asDone().build());
      };

      const executePromise = useCase.execute(makeInput());

      // Wait for monitor to be registered (async repository calls settle first)
      await new Promise((r) => setTimeout(r, 50));

      // Trigger overseer timeout for the first attempt
      overseerAdapter.triggerVerdict(T1_ID, {
        strategy: "timeout",
        reason: "Task exceeded S timeout of 300000ms",
      });

      const result = await executePromise;

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.completedTasks).toContain(T1_ID);

      // Verify 2 dispatch calls (first aborted, second succeeded)
      expect(capturedConfigs.length).toBe(2);

      // Verify journal entries
      const journalResult = await journalRepo.readAll(SLICE_ID);
      if (!journalResult.ok) return;
      const interventions = journalResult.data.filter((e) => e.type === "overseer-intervention");

      // Should have aborted + retrying entries
      const abortEntry = interventions.find(
        (e) => e.type === "overseer-intervention" && e.action === "aborted",
      );
      const retryEntry = interventions.find(
        (e) => e.type === "overseer-intervention" && e.action === "retrying",
      );
      expect(abortEntry).toBeDefined();
      expect(retryEntry).toBeDefined();

      if (abortEntry?.type === "overseer-intervention") {
        expect(abortEntry.strategy).toBe("timeout");
        expect(abortEntry.taskId).toBe(T1_ID);
        expect(abortEntry.retryCount).toBe(0);
      }
    });

    it("enriches prompt with error context on retry (AC4)", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);

      const capturedConfigs: AgentDispatchConfig[] = [];
      let dispatchCall = 0;
      agentDispatch.dispatch = async (
        config: AgentDispatchConfig,
      ): Promise<Result<AgentResult, AgentDispatchError>> => {
        capturedConfigs.push(config);
        dispatchCall++;
        if (dispatchCall === 1) {
          return new Promise<Result<AgentResult, AgentDispatchError>>(() => {});
        }
        return ok(new AgentResultBuilder().withTaskId(config.taskId).asDone().build());
      };

      const executePromise = useCase.execute(makeInput());
      await new Promise((r) => setTimeout(r, 50));

      overseerAdapter.triggerVerdict(T1_ID, {
        strategy: "timeout",
        reason: "Task exceeded S timeout of 300000ms",
      });

      await executePromise;

      // Second dispatch config should contain enriched prompt
      expect(capturedConfigs.length).toBe(2);
      const retryConfig = capturedConfigs[1];
      expect(retryConfig).toBeDefined();
      if (retryConfig) {
        expect(retryConfig.taskPrompt).toContain("[OVERSEER]");
        expect(retryConfig.taskPrompt).toContain("Previous attempt failed");
        expect(retryConfig.taskPrompt).toContain("300000ms");
      }
    });

    it("escalates immediately when retry policy denies retry (AC2)", async () => {
      // maxRetries=0 → immediate escalation
      const noRetryPolicy = new DefaultRetryPolicy(0, 3);
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
        retryPolicy: noRetryPolicy,
        overseerConfig: OVERSEER_CONFIG,
        preDispatchGuardrail: preDispatchAdapter,
      });

      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);

      agentDispatch.dispatch = async (
        _config: AgentDispatchConfig,
      ): Promise<Result<AgentResult, AgentDispatchError>> => {
        return new Promise<Result<AgentResult, AgentDispatchError>>(() => {});
      };

      const executePromise = useCase.execute(makeInput());
      await new Promise((r) => setTimeout(r, 50));

      overseerAdapter.triggerVerdict(T1_ID, {
        strategy: "timeout",
        reason: "Task exceeded S timeout",
      });

      const result = await executePromise;

      // Should fail (escalated, no retry) — collected as failure, not aborted
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.failedTasks).toContain(T1_ID);

      // Verify escalation journal entry
      const journalResult = await journalRepo.readAll(SLICE_ID);
      if (!journalResult.ok) return;
      const interventions = journalResult.data.filter((e) => e.type === "overseer-intervention");

      const escalated = interventions.find(
        (e) => e.type === "overseer-intervention" && e.action === "escalated",
      );
      expect(escalated).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // signal-based abort
  // -------------------------------------------------------------------------
  describe("signal-based abort", () => {
    it("returns aborted=true when signal is aborted between waves", async () => {
      // Two tasks in separate waves: T1 (wave 0), T2 blocked by T1 (wave 1)
      const t1 = makeTask(T1_ID, "T01");
      const t2 = makeTask(T2_ID, "T02", [T1_ID]);
      taskRepo.seed(t1);
      taskRepo.seed(t2);

      agentDispatch.givenResult(
        T1_ID,
        ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
      );

      // Create AbortController and abort before second wave
      const controller = new AbortController();
      const originalDispatch = agentDispatch.dispatch.bind(agentDispatch);
      let dispatchCount = 0;
      agentDispatch.dispatch = async (cfg: AgentDispatchConfig) => {
        dispatchCount++;
        const result = await originalDispatch(cfg);
        // After first task completes, abort the signal
        if (dispatchCount === 1) controller.abort();
        return result;
      };

      const result = await useCase.execute(makeInput(), controller.signal);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.aborted).toBe(true);
        expect(result.data.completedTasks).toContain(T1_ID);
        expect(result.data.wavesCompleted).toBe(0);
      }
    });

    it("runs normally when no signal provided", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);
      agentDispatch.givenResult(
        T1_ID,
        ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
      );

      const result = await useCase.execute(makeInput());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.aborted).toBe(false);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Pre-dispatch guardrail (T11)
  // -----------------------------------------------------------------------
  describe("pre-dispatch guardrail", () => {
    it("blocks dispatch when pre-dispatch guardrail returns blocker", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);

      preDispatchAdapter.setReport({
        passed: false,
        violations: [
          { ruleId: "scope-containment", severity: "blocker", message: "File outside scope" },
        ],
        checkedAt: new Date().toISOString(),
      });

      agentDispatch.givenResult(
        T1_ID,
        ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
      );

      const result = await useCase.execute(makeInput());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Task should NOT be dispatched (pre-dispatch blocked)
      expect(agentDispatch.wasDispatched(T1_ID)).toBe(false);
      expect(result.data.failedTasks).toContain(T1_ID);
    });

    it("journals pre-dispatch-blocked entry on blocker", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);

      preDispatchAdapter.setReport({
        passed: false,
        violations: [
          { ruleId: "scope-containment", severity: "blocker", message: "File outside scope" },
        ],
        checkedAt: new Date().toISOString(),
      });

      agentDispatch.givenResult(
        T1_ID,
        ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
      );

      await useCase.execute(makeInput());

      const journalResult = await journalRepo.readAll(SLICE_ID);
      expect(journalResult.ok).toBe(true);
      if (!journalResult.ok) return;
      const pdEntries = journalResult.data.filter((e) => e.type === "pre-dispatch-blocked");
      expect(pdEntries.length).toBeGreaterThanOrEqual(1);
      const entry = pdEntries[0];
      if (entry?.type !== "pre-dispatch-blocked") return;
      expect(entry.taskId).toBe(T1_ID);
      expect(entry.severity).toBe("blocker");
    });

    it("proceeds with dispatch on pre-dispatch warning", async () => {
      const t1 = makeTask(T1_ID, "T01");
      taskRepo.seed(t1);

      preDispatchAdapter.setReport({
        passed: true,
        violations: [
          { ruleId: "budget-check", severity: "warning", message: "Budget running low" },
        ],
        checkedAt: new Date().toISOString(),
      });

      agentDispatch.givenResult(
        T1_ID,
        ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
      );

      const result = await useCase.execute(makeInput());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Task SHOULD be dispatched despite warning
      expect(agentDispatch.wasDispatched(T1_ID)).toBe(true);
      expect(result.data.completedTasks).toContain(T1_ID);

      // Warning should be journaled
      const journalResult = await journalRepo.readAll(SLICE_ID);
      expect(journalResult.ok).toBe(true);
      if (!journalResult.ok) return;
      const pdEntries = journalResult.data.filter((e) => e.type === "pre-dispatch-blocked");
      expect(pdEntries.length).toBeGreaterThanOrEqual(1);
    });

    it("one task blocked, sibling in wave still dispatched and succeeds", async () => {
      const t1 = makeTask(T1_ID, "T01");
      const t2 = makeTask(T2_ID, "T02");
      taskRepo.seed(t1);
      taskRepo.seed(t2);

      // Set up per-task pre-dispatch: block T1 but allow T2
      // InMemoryPreDispatchAdapter returns same report for all tasks,
      // so we use a custom implementation
      let callCount = 0;
      const origValidate = preDispatchAdapter.validate.bind(preDispatchAdapter);
      preDispatchAdapter.validate = async (ctx) => {
        callCount++;
        if (ctx.taskId === T1_ID) {
          return ok({
            passed: false,
            violations: [
              { ruleId: "scope", severity: "blocker" as const, message: "blocked" },
            ],
            checkedAt: new Date().toISOString(),
          });
        }
        return origValidate(ctx);
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
      // T1 blocked, T2 dispatched
      expect(agentDispatch.wasDispatched(T1_ID)).toBe(false);
      expect(agentDispatch.wasDispatched(T2_ID)).toBe(true);
      expect(result.data.failedTasks).toContain(T1_ID);
      expect(result.data.completedTasks).toContain(T2_ID);
    });
  });
});

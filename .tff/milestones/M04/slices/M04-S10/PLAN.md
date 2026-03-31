# M04-S10: Execute/Pause/Resume Commands — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Wire execute/pause/resume lifecycle via ExecutionSession aggregate + ExecutionCoordinator use case + 3 PI extension tools.
**Architecture:** ExecutionSession (domain state machine) + ExecutionCoordinator (application orchestrator) + PauseSignalPort (SIGINT abstraction).
**Tech Stack:** TypeScript, Zod, Vitest, hexagonal architecture.

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/hexagons/execution/domain/execution-session.schemas.ts` | Props + status schemas |
| `src/hexagons/execution/domain/execution-session.schemas.spec.ts` | Schema validation tests |
| `src/hexagons/execution/domain/execution-session.aggregate.ts` | State machine + AbortController |
| `src/hexagons/execution/domain/execution-session.aggregate.spec.ts` | State machine tests |
| `src/hexagons/execution/domain/ports/execution-session-repository.port.ts` | Repository port |
| `src/hexagons/execution/domain/ports/pause-signal.port.ts` | Pause signal abstraction |
| `src/hexagons/execution/domain/events/execution-started.event.ts` | Event |
| `src/hexagons/execution/domain/events/execution-paused.event.ts` | Event |
| `src/hexagons/execution/domain/events/execution-resumed.event.ts` | Event |
| `src/hexagons/execution/domain/events/execution-completed.event.ts` | Event |
| `src/hexagons/execution/domain/events/execution-failed.event.ts` | Event |
| `src/hexagons/execution/infrastructure/in-memory-pause-signal.adapter.ts` | Test double |
| `src/hexagons/execution/infrastructure/process-signal-pause.adapter.ts` | SIGINT adapter |
| `src/hexagons/execution/infrastructure/in-memory-execution-session.adapter.ts` | Test double |
| `src/hexagons/execution/infrastructure/markdown-execution-session.adapter.ts` | CHECKPOINT.md session block |
| `src/hexagons/execution/infrastructure/markdown-execution-session.adapter.spec.ts` | Persistence tests |
| `src/hexagons/execution/application/execution-coordinator.schemas.ts` | Input/output schemas |
| `src/hexagons/execution/application/execution-coordinator.use-case.ts` | Coordinator orchestration |
| `src/hexagons/execution/application/execution-coordinator.use-case.spec.ts` | Coordinator tests |
| `src/hexagons/execution/infrastructure/pi/execution.extension.ts` | Extension registration |
| `src/hexagons/execution/infrastructure/pi/execute-slice.tool.ts` | Execute tool |
| `src/hexagons/execution/infrastructure/pi/pause-execution.tool.ts` | Pause tool |
| `src/hexagons/execution/infrastructure/pi/resume-execution.tool.ts` | Resume tool |

### Modified Files
| File | Change |
|---|---|
| `src/kernel/event-names.ts` | Add 5 execution lifecycle event names |
| `src/hexagons/execution/domain/journal-entry.schemas.ts` | Add `execution-lifecycle` entry type |
| `src/hexagons/execution/application/execute-slice.use-case.ts` | Add `signal?: AbortSignal` param, check between waves |
| `src/hexagons/execution/application/execute-slice.use-case.spec.ts` | Add signal abort test |
| `src/hexagons/execution/application/journal-event-handler.ts` | Subscribe to 5 execution events |
| `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.ts` | Preserve session-data block |
| `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.spec.ts` | Collaborative writer test |
| `src/hexagons/execution/index.ts` | Export new types |
| `src/cli/extension.ts` | Wire execution extension |

---

## Wave 0 (parallel — no dependencies)

### T01: ExecutionSession schemas

**Create:** `src/hexagons/execution/domain/execution-session.schemas.ts`
**Create:** `src/hexagons/execution/domain/execution-session.schemas.spec.ts`
**Traces to:** AC4

- [ ] Step 1: Write failing tests

**File:** `src/hexagons/execution/domain/execution-session.schemas.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import {
  ExecutionSessionPropsSchema,
  ExecutionSessionStatusSchema,
} from "./execution-session.schemas";

describe("ExecutionSessionStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of ["created", "running", "paused", "completed", "failed"]) {
      expect(ExecutionSessionStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects unknown status", () => {
    expect(ExecutionSessionStatusSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("ExecutionSessionPropsSchema", () => {
  const validProps = {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    sliceId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    milestoneId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    status: "created",
    resumeCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("accepts valid props", () => {
    expect(ExecutionSessionPropsSchema.safeParse(validProps).success).toBe(true);
  });

  it("accepts props with optional fields", () => {
    const result = ExecutionSessionPropsSchema.safeParse({
      ...validProps,
      status: "failed",
      failureReason: "Journal inconsistency",
      startedAt: new Date(),
      pausedAt: new Date(),
      completedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative resumeCount", () => {
    expect(
      ExecutionSessionPropsSchema.safeParse({ ...validProps, resumeCount: -1 }).success,
    ).toBe(false);
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/domain/execution-session.schemas.spec.ts`
**Expect:** FAIL — module not found

- [ ] Step 3: Implement schemas

**File:** `src/hexagons/execution/domain/execution-session.schemas.ts`
```typescript
import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const ExecutionSessionStatusSchema = z.enum([
  "created",
  "running",
  "paused",
  "completed",
  "failed",
]);
export type ExecutionSessionStatus = z.infer<typeof ExecutionSessionStatusSchema>;

export const ExecutionSessionPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  milestoneId: IdSchema,
  status: ExecutionSessionStatusSchema,
  resumeCount: z.number().int().min(0),
  failureReason: z.string().optional(),
  startedAt: TimestampSchema.optional(),
  pausedAt: TimestampSchema.optional(),
  completedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ExecutionSessionProps = z.infer<typeof ExecutionSessionPropsSchema>;
```

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/domain/execution-session.schemas.spec.ts`
**Expect:** PASS — 4/4 tests passing

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/domain/execution-session.schemas.ts src/hexagons/execution/domain/execution-session.schemas.spec.ts && git commit -m "feat(S10/T01): ExecutionSession schemas"`

---

### T02: PauseSignalPort + InMemory adapter

**Create:** `src/hexagons/execution/domain/ports/pause-signal.port.ts`
**Create:** `src/hexagons/execution/infrastructure/in-memory-pause-signal.adapter.ts`
**Traces to:** AC5

- [ ] Step 1: Implement port (no test needed for abstract class)

**File:** `src/hexagons/execution/domain/ports/pause-signal.port.ts`
```typescript
export abstract class PauseSignalPort {
  abstract register(callback: () => void): void;
  abstract dispose(): void;
}
```

- [ ] Step 2: Implement InMemory adapter

**File:** `src/hexagons/execution/infrastructure/in-memory-pause-signal.adapter.ts`
```typescript
import { PauseSignalPort } from "../domain/ports/pause-signal.port";

export class InMemoryPauseSignalAdapter extends PauseSignalPort {
  private callback: (() => void) | null = null;

  register(callback: () => void): void {
    this.callback = callback;
  }

  dispose(): void {
    this.callback = null;
  }

  triggerPause(): void {
    if (this.callback) {
      this.callback();
    }
  }

  reset(): void {
    this.callback = null;
  }
}
```

- [ ] Step 3: Commit
**Run:** `git add src/hexagons/execution/domain/ports/pause-signal.port.ts src/hexagons/execution/infrastructure/in-memory-pause-signal.adapter.ts && git commit -m "feat(S10/T02): PauseSignalPort + InMemory adapter"`

---

### T03: EVENT_NAMES + 5 domain event classes

**Modify:** `src/kernel/event-names.ts`
**Create:** 5 event files in `src/hexagons/execution/domain/events/`
**Traces to:** AC7

- [ ] Step 1: Add event names to kernel

**File:** `src/kernel/event-names.ts` — add to `EVENT_NAMES` object:
```typescript
EXECUTION_STARTED: "execution.started",
EXECUTION_PAUSED: "execution.paused",
EXECUTION_RESUMED: "execution.resumed",
EXECUTION_COMPLETED: "execution.completed",
EXECUTION_FAILED: "execution.failed",
```
Add to `EventNameSchema` enum array:
```typescript
EVENT_NAMES.EXECUTION_STARTED,
EVENT_NAMES.EXECUTION_PAUSED,
EVENT_NAMES.EXECUTION_RESUMED,
EVENT_NAMES.EXECUTION_COMPLETED,
EVENT_NAMES.EXECUTION_FAILED,
```

- [ ] Step 2: Create ExecutionStartedEvent

**File:** `src/hexagons/execution/domain/events/execution-started.event.ts`
```typescript
import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName, IdSchema } from "@kernel";
import { z } from "zod";

const ExecutionStartedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  milestoneId: IdSchema,
  sessionId: IdSchema,
});

type ExecutionStartedEventProps = z.infer<typeof ExecutionStartedEventPropsSchema>;

export class ExecutionStartedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.EXECUTION_STARTED;
  readonly sliceId: string;
  readonly milestoneId: string;
  readonly sessionId: string;

  constructor(props: ExecutionStartedEventProps) {
    const parsed = ExecutionStartedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.milestoneId = parsed.milestoneId;
    this.sessionId = parsed.sessionId;
  }
}
```

- [ ] Step 3: Create ExecutionPausedEvent

**File:** `src/hexagons/execution/domain/events/execution-paused.event.ts`
```typescript
import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName, IdSchema } from "@kernel";
import { z } from "zod";

const ExecutionPausedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  sessionId: IdSchema,
  resumeCount: z.number().int().min(0),
});

type ExecutionPausedEventProps = z.infer<typeof ExecutionPausedEventPropsSchema>;

export class ExecutionPausedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.EXECUTION_PAUSED;
  readonly sliceId: string;
  readonly sessionId: string;
  readonly resumeCount: number;

  constructor(props: ExecutionPausedEventProps) {
    const parsed = ExecutionPausedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.sessionId = parsed.sessionId;
    this.resumeCount = parsed.resumeCount;
  }
}
```

- [ ] Step 4: Create ExecutionResumedEvent

**File:** `src/hexagons/execution/domain/events/execution-resumed.event.ts`
```typescript
import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName, IdSchema } from "@kernel";
import { z } from "zod";

const ExecutionResumedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  sessionId: IdSchema,
  resumeCount: z.number().int().min(0),
});

type ExecutionResumedEventProps = z.infer<typeof ExecutionResumedEventPropsSchema>;

export class ExecutionResumedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.EXECUTION_RESUMED;
  readonly sliceId: string;
  readonly sessionId: string;
  readonly resumeCount: number;

  constructor(props: ExecutionResumedEventProps) {
    const parsed = ExecutionResumedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.sessionId = parsed.sessionId;
    this.resumeCount = parsed.resumeCount;
  }
}
```

- [ ] Step 5: Create ExecutionCompletedEvent

**File:** `src/hexagons/execution/domain/events/execution-completed.event.ts`
```typescript
import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName, IdSchema } from "@kernel";
import { z } from "zod";

const ExecutionCompletedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  sessionId: IdSchema,
  resumeCount: z.number().int().min(0),
  wavesCompleted: z.number().int().min(0),
  totalWaves: z.number().int().min(0),
});

type ExecutionCompletedEventProps = z.infer<typeof ExecutionCompletedEventPropsSchema>;

export class ExecutionCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.EXECUTION_COMPLETED;
  readonly sliceId: string;
  readonly sessionId: string;
  readonly resumeCount: number;
  readonly wavesCompleted: number;
  readonly totalWaves: number;

  constructor(props: ExecutionCompletedEventProps) {
    const parsed = ExecutionCompletedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.sessionId = parsed.sessionId;
    this.resumeCount = parsed.resumeCount;
    this.wavesCompleted = parsed.wavesCompleted;
    this.totalWaves = parsed.totalWaves;
  }
}
```

- [ ] Step 6: Create ExecutionFailedEvent

**File:** `src/hexagons/execution/domain/events/execution-failed.event.ts`
```typescript
import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName, IdSchema } from "@kernel";
import { z } from "zod";

const ExecutionFailedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  sessionId: IdSchema,
  resumeCount: z.number().int().min(0),
  failureReason: z.string().min(1),
  wavesCompleted: z.number().int().min(0).optional(),
  totalWaves: z.number().int().min(0).optional(),
});

type ExecutionFailedEventProps = z.infer<typeof ExecutionFailedEventPropsSchema>;

export class ExecutionFailedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.EXECUTION_FAILED;
  readonly sliceId: string;
  readonly sessionId: string;
  readonly resumeCount: number;
  readonly failureReason: string;
  readonly wavesCompleted?: number;
  readonly totalWaves?: number;

  constructor(props: ExecutionFailedEventProps) {
    const parsed = ExecutionFailedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.sessionId = parsed.sessionId;
    this.resumeCount = parsed.resumeCount;
    this.failureReason = parsed.failureReason;
    this.wavesCompleted = parsed.wavesCompleted;
    this.totalWaves = parsed.totalWaves;
  }
}
```

- [ ] Step 7: Run existing kernel tests to verify no regression
**Run:** `npx vitest run src/kernel/`
**Expect:** PASS — all existing tests still pass

- [ ] Step 8: Commit
**Run:** `git add src/kernel/event-names.ts src/hexagons/execution/domain/events/execution-started.event.ts src/hexagons/execution/domain/events/execution-paused.event.ts src/hexagons/execution/domain/events/execution-resumed.event.ts src/hexagons/execution/domain/events/execution-completed.event.ts src/hexagons/execution/domain/events/execution-failed.event.ts && git commit -m "feat(S10/T03): execution lifecycle event names + 5 domain events"`

---

### T04: Journal entry schema extension

**Modify:** `src/hexagons/execution/domain/journal-entry.schemas.ts`
**Traces to:** AC7

- [ ] Step 1: Add ExecutionLifecycleEntrySchema to journal-entry.schemas.ts

After `OverseerInterventionEntrySchema`, add:
```typescript
export const ExecutionLifecycleEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("execution-lifecycle"),
  sessionId: IdSchema,
  action: z.enum(["started", "paused", "resumed", "completed", "failed"]),
  resumeCount: z.number().int().min(0),
  failureReason: z.string().optional(),
  wavesCompleted: z.number().int().min(0).optional(),
  totalWaves: z.number().int().min(0).optional(),
});
export type ExecutionLifecycleEntry = z.infer<typeof ExecutionLifecycleEntrySchema>;
```

Add `ExecutionLifecycleEntrySchema` to the discriminated union array:
```typescript
export const JournalEntrySchema = z.discriminatedUnion("type", [
  // ... existing entries ...
  ExecutionLifecycleEntrySchema,
]);
```

- [ ] Step 2: Run existing journal tests
**Run:** `npx vitest run src/hexagons/execution/domain/`
**Expect:** PASS — no regression

- [ ] Step 3: Commit
**Run:** `git add src/hexagons/execution/domain/journal-entry.schemas.ts && git commit -m "feat(S10/T04): execution-lifecycle journal entry schema"`

---

### T07: ExecuteSliceUseCase signal modification

**Modify:** `src/hexagons/execution/application/execute-slice.use-case.ts`
**Modify:** `src/hexagons/execution/application/execute-slice.use-case.spec.ts`
**Traces to:** AC5, AC10

- [ ] Step 1: Write failing test for signal-based abort

**File:** `src/hexagons/execution/application/execute-slice.use-case.spec.ts` — add test:
```typescript
describe("signal-based abort", () => {
  it("returns aborted=true when signal is aborted between waves", async () => {
    // Two tasks in separate waves: T1 (wave 0), T2 blocked by T1 (wave 1)
    const t1 = makeTask(T1_ID, "T01");
    const t2 = makeTask(T2_ID, "T02", [T1_ID]);
    taskRepo.seed(t1);
    taskRepo.seed(t2);
    worktreeAdapter.addWorktree(SLICE_ID);
    agentDispatch.givenResult(T1_ID, ok(AgentResultBuilder.done(T1_ID)));

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
    worktreeAdapter.addWorktree(SLICE_ID);
    agentDispatch.givenResult(T1_ID, ok(AgentResultBuilder.done(T1_ID)));

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.aborted).toBe(false);
    }
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/application/execute-slice.use-case.spec.ts -t "signal-based abort"`
**Expect:** FAIL — execute() does not accept second argument / signal not checked

- [ ] Step 3: Modify ExecuteSliceUseCase

**File:** `src/hexagons/execution/application/execute-slice.use-case.ts`

Change method signature (line 178):
```typescript
async execute(input: ExecuteSliceInput, signal?: AbortSignal): Promise<Result<ExecuteSliceResult, ExecutionError>> {
```

After `advanceWave` checkpoint save + event publish (after the `for` loop for `advanceEvents`), before `wavesCompleted++`, add:
```typescript
      // 6i. Check abort signal between waves
      if (signal?.aborted) {
        return ok({
          sliceId: input.sliceId,
          completedTasks,
          failedTasks,
          skippedTasks,
          wavesCompleted,
          totalWaves: waves.length,
          aborted: true,
        });
      }
```

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/application/execute-slice.use-case.spec.ts`
**Expect:** PASS — all tests passing including new signal tests

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/application/execute-slice.use-case.ts src/hexagons/execution/application/execute-slice.use-case.spec.ts && git commit -m "feat(S10/T07): ExecuteSliceUseCase abort signal between waves"`

---

### T08: MarkdownCheckpointRepository collaborative writer

**Modify:** `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.ts`
**Modify:** `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.spec.ts`
**Traces to:** AC8

- [ ] Step 1: Write failing integration test

**File:** `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.spec.ts` — add test:
```typescript
describe("collaborative writer — session-data preservation", () => {
  it("preserves session-data block across checkpoint saves", async () => {
    const checkpoint = Checkpoint.createNew({
      id: crypto.randomUUID(),
      sliceId: SLICE_ID,
      baseCommit: "abc123",
      now: new Date(),
    });

    // First save
    await repo.save(checkpoint);

    // Manually inject session-data block (simulating MarkdownExecutionSessionAdapter)
    const cpPath = join(tmpDir, SLICE_PATH, "CHECKPOINT.md");
    const original = await readFile(cpPath, "utf-8");
    const sessionBlock = '<!-- session-data: {"id":"session-1","status":"running","resumeCount":0} -->';
    await writeFile(cpPath, original + "\n" + sessionBlock + "\n", "utf-8");

    // Second save (should preserve session-data)
    checkpoint.recordTaskStart("task-1", "agent-1", new Date());
    await repo.save(checkpoint);

    const content = await readFile(cpPath, "utf-8");
    expect(content).toContain("<!-- CHECKPOINT_JSON");
    expect(content).toContain("<!-- session-data:");
    expect(content).toContain('"status":"running"');
  });
});
```

- [ ] Step 2: Run test, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/infrastructure/markdown-checkpoint.repository.spec.ts -t "session-data preservation"`
**Expect:** FAIL — session-data block destroyed by save

- [ ] Step 3: Modify save() to preserve session block

**File:** `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.ts`

In `save()` method, before `const content = this.renderMarkdown(props)`, add:
```typescript
    // Preserve session-data block written by MarkdownExecutionSessionAdapter
    let sessionBlock = "";
    try {
      const existing = await readFile(filePath, "utf-8");
      const sessionMatch = existing.match(/<!-- session-data: [\s\S]*? -->/);
      if (sessionMatch) {
        sessionBlock = sessionMatch[0];
      }
    } catch {
      // File does not exist yet — no session block to preserve
    }

    const content = this.renderMarkdown(props)
      + (sessionBlock ? `\n${sessionBlock}\n` : "");
```

Remove the existing `const content = this.renderMarkdown(props);` line.

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/infrastructure/markdown-checkpoint.repository.spec.ts`
**Expect:** PASS — all tests passing including collaborative writer test

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/infrastructure/markdown-checkpoint.repository.ts src/hexagons/execution/infrastructure/markdown-checkpoint.repository.spec.ts && git commit -m "feat(S10/T08): MarkdownCheckpointRepository preserves session-data block"`

---

## Wave 1 (depends on Wave 0)

### T05: ExecutionSession aggregate

**Create:** `src/hexagons/execution/domain/execution-session.aggregate.ts`
**Create:** `src/hexagons/execution/domain/execution-session.aggregate.spec.ts`
**Depends:** T01 (schemas), T03 (events)
**Traces to:** AC4, AC5

- [ ] Step 1: Write failing tests for state machine

**File:** `src/hexagons/execution/domain/execution-session.aggregate.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import { ExecutionSession } from "./execution-session.aggregate";

const SLICE_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const MILESTONE_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const NOW = new Date("2026-03-30T12:00:00Z");

function createSession(): ExecutionSession {
  return ExecutionSession.createNew({
    id: crypto.randomUUID(),
    sliceId: SLICE_ID,
    milestoneId: MILESTONE_ID,
    now: NOW,
  });
}

describe("ExecutionSession", () => {
  describe("createNew", () => {
    it("creates session in 'created' status", () => {
      const session = createSession();
      expect(session.status).toBe("created");
      expect(session.resumeCount).toBe(0);
    });
  });

  describe("start", () => {
    it("transitions created → running", () => {
      const session = createSession();
      session.start(NOW);
      expect(session.status).toBe("running");
      expect(session.signal).toBeDefined();
      expect(session.signal.aborted).toBe(false);
    });

    it("emits ExecutionStartedEvent", () => {
      const session = createSession();
      session.start(NOW);
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("execution.started");
    });

    it("throws from paused", () => {
      const session = createSession();
      session.start(NOW);
      session.confirmPause(NOW);
      expect(() => session.start(NOW)).toThrow();
    });
  });

  describe("requestPause", () => {
    it("aborts the signal", () => {
      const session = createSession();
      session.start(NOW);
      session.requestPause();
      expect(session.signal.aborted).toBe(true);
      expect(session.isPauseRequested).toBe(true);
    });

    it("is idempotent", () => {
      const session = createSession();
      session.start(NOW);
      session.requestPause();
      session.requestPause(); // no throw
      expect(session.isPauseRequested).toBe(true);
    });

    it("no-ops from created (late signal safety)", () => {
      const session = createSession();
      session.requestPause(); // no throw, no effect
      expect(session.status).toBe("created");
    });
  });

  describe("confirmPause", () => {
    it("transitions running → paused", () => {
      const session = createSession();
      session.start(NOW);
      session.confirmPause(NOW);
      expect(session.status).toBe("paused");
    });

    it("emits ExecutionPausedEvent", () => {
      const session = createSession();
      session.start(NOW);
      session.pullEvents(); // clear start event
      session.confirmPause(NOW);
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("execution.paused");
    });
  });

  describe("resume", () => {
    it("transitions paused → running with fresh signal", () => {
      const session = createSession();
      session.start(NOW);
      const oldSignal = session.signal;
      session.confirmPause(NOW);
      session.resume(NOW);
      expect(session.status).toBe("running");
      expect(session.signal).not.toBe(oldSignal);
      expect(session.signal.aborted).toBe(false);
      expect(session.resumeCount).toBe(1);
    });

    it("emits ExecutionResumedEvent", () => {
      const session = createSession();
      session.start(NOW);
      session.confirmPause(NOW);
      session.pullEvents(); // clear
      session.resume(NOW);
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("execution.resumed");
    });

    it("throws from running", () => {
      const session = createSession();
      session.start(NOW);
      expect(() => session.resume(NOW)).toThrow();
    });
  });

  describe("complete", () => {
    it("transitions running → completed with wave data", () => {
      const session = createSession();
      session.start(NOW);
      session.complete(NOW, 3, 3);
      expect(session.status).toBe("completed");
    });

    it("emits ExecutionCompletedEvent with wave data", () => {
      const session = createSession();
      session.start(NOW);
      session.pullEvents();
      session.complete(NOW, 3, 4);
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("execution.completed");
    });
  });

  describe("fail", () => {
    it("transitions running → failed with reason and wave data", () => {
      const session = createSession();
      session.start(NOW);
      session.fail("timeout", NOW, 1, 3);
      expect(session.status).toBe("failed");
      expect(session.failureReason).toBe("timeout");
    });

    it("emits ExecutionFailedEvent", () => {
      const session = createSession();
      session.start(NOW);
      session.pullEvents();
      session.fail("timeout", NOW);
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("execution.failed");
    });
  });

  describe("reconstitute", () => {
    it("restores state from props", () => {
      const session = createSession();
      session.start(NOW);
      const props = session.toJSON();
      const restored = ExecutionSession.reconstitute(props);
      expect(restored.status).toBe("running");
      expect(restored.signal.aborted).toBe(false); // fresh AbortController
      expect(restored.isPauseRequested).toBe(false);
    });
  });

  describe("canResume", () => {
    it("true when paused", () => {
      const session = createSession();
      session.start(NOW);
      session.confirmPause(NOW);
      expect(session.canResume).toBe(true);
    });

    it("false when running", () => {
      const session = createSession();
      session.start(NOW);
      expect(session.canResume).toBe(false);
    });
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/domain/execution-session.aggregate.spec.ts`
**Expect:** FAIL — module not found

- [ ] Step 3: Implement ExecutionSession aggregate

**File:** `src/hexagons/execution/domain/execution-session.aggregate.ts`
```typescript
import { AggregateRoot } from "@kernel";
import { type ExecutionSessionProps, ExecutionSessionPropsSchema } from "./execution-session.schemas";
import { ExecutionCompletedEvent } from "./events/execution-completed.event";
import { ExecutionFailedEvent } from "./events/execution-failed.event";
import { ExecutionPausedEvent } from "./events/execution-paused.event";
import { ExecutionResumedEvent } from "./events/execution-resumed.event";
import { ExecutionStartedEvent } from "./events/execution-started.event";

export class ExecutionSession extends AggregateRoot<ExecutionSessionProps> {
  private controller: AbortController = new AbortController();

  private constructor(props: ExecutionSessionProps) {
    super(props, ExecutionSessionPropsSchema);
  }

  // -- Factories --

  static createNew(params: {
    id: string;
    sliceId: string;
    milestoneId: string;
    now: Date;
  }): ExecutionSession {
    return new ExecutionSession({
      id: params.id,
      sliceId: params.sliceId,
      milestoneId: params.milestoneId,
      status: "created",
      resumeCount: 0,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static reconstitute(props: ExecutionSessionProps): ExecutionSession {
    return new ExecutionSession(props);
  }

  // -- Getters --

  get id(): string { return this.props.id; }
  get sliceId(): string { return this.props.sliceId; }
  get milestoneId(): string { return this.props.milestoneId; }
  get status(): string { return this.props.status; }
  get resumeCount(): number { return this.props.resumeCount; }
  get failureReason(): string | undefined { return this.props.failureReason; }
  get signal(): AbortSignal { return this.controller.signal; }
  get isPauseRequested(): boolean { return this.controller.signal.aborted; }
  get canResume(): boolean { return this.props.status === "paused"; }

  // -- State transitions --

  start(now: Date): void {
    this.assertStatus("created");
    this.controller = new AbortController();
    this.props.status = "running";
    this.props.startedAt = now;
    this.props.updatedAt = now;
    this.addEvent(new ExecutionStartedEvent({
      id: crypto.randomUUID(),
      aggregateId: this.props.id,
      occurredAt: now,
      sliceId: this.props.sliceId,
      milestoneId: this.props.milestoneId,
      sessionId: this.props.id,
    }));
  }

  requestPause(): void {
    // No-op for non-running states (late SIGINT after pause/complete/fail is safe)
    if (this.props.status !== "running") return;
    this.controller.abort();
  }

  confirmPause(now: Date): void {
    this.assertStatus("running");
    this.props.status = "paused";
    this.props.pausedAt = now;
    this.props.updatedAt = now;
    this.addEvent(new ExecutionPausedEvent({
      id: crypto.randomUUID(),
      aggregateId: this.props.id,
      occurredAt: now,
      sliceId: this.props.sliceId,
      sessionId: this.props.id,
      resumeCount: this.props.resumeCount,
    }));
  }

  resume(now: Date): void {
    this.assertStatus("paused");
    this.controller = new AbortController();
    this.props.status = "running";
    this.props.resumeCount += 1;
    this.props.startedAt = now;
    this.props.pausedAt = undefined;
    this.props.updatedAt = now;
    this.addEvent(new ExecutionResumedEvent({
      id: crypto.randomUUID(),
      aggregateId: this.props.id,
      occurredAt: now,
      sliceId: this.props.sliceId,
      sessionId: this.props.id,
      resumeCount: this.props.resumeCount,
    }));
  }

  complete(now: Date, wavesCompleted: number, totalWaves: number): void {
    this.assertStatus("running");
    this.props.status = "completed";
    this.props.completedAt = now;
    this.props.updatedAt = now;
    this.addEvent(new ExecutionCompletedEvent({
      id: crypto.randomUUID(),
      aggregateId: this.props.id,
      occurredAt: now,
      sliceId: this.props.sliceId,
      sessionId: this.props.id,
      resumeCount: this.props.resumeCount,
      wavesCompleted,
      totalWaves,
    }));
  }

  fail(reason: string, now: Date, wavesCompleted?: number, totalWaves?: number): void {
    this.assertStatus("running");
    this.props.status = "failed";
    this.props.failureReason = reason;
    this.props.updatedAt = now;
    this.addEvent(new ExecutionFailedEvent({
      id: crypto.randomUUID(),
      aggregateId: this.props.id,
      occurredAt: now,
      sliceId: this.props.sliceId,
      sessionId: this.props.id,
      resumeCount: this.props.resumeCount,
      failureReason: reason,
      wavesCompleted,
      totalWaves,
    }));
  }

  // -- Private --

  private assertStatus(expected: string): void {
    if (this.props.status !== expected) {
      throw new Error(
        `Invalid state transition: expected '${expected}', got '${this.props.status}'`,
      );
    }
  }
}
```

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/domain/execution-session.aggregate.spec.ts`
**Expect:** PASS — all tests passing

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/domain/execution-session.aggregate.ts src/hexagons/execution/domain/execution-session.aggregate.spec.ts && git commit -m "feat(S10/T05): ExecutionSession aggregate with state machine + AbortController"`

---

### T09: JournalEventHandler extension

**Modify:** `src/hexagons/execution/application/journal-event-handler.ts`
**Depends:** T03 (events), T04 (journal entry schema)
**Traces to:** AC7

- [ ] Step 1: Add 5 new event subscriptions to `register()` and handler methods

**File:** `src/hexagons/execution/application/journal-event-handler.ts`

Add imports:
```typescript
import { ExecutionCompletedEvent } from "../domain/events/execution-completed.event";
import { ExecutionFailedEvent } from "../domain/events/execution-failed.event";
import { ExecutionPausedEvent } from "../domain/events/execution-paused.event";
import { ExecutionResumedEvent } from "../domain/events/execution-resumed.event";
import { ExecutionStartedEvent } from "../domain/events/execution-started.event";
import type { ExecutionLifecycleEntry } from "../domain/journal-entry.schemas";
```

Add to `register()`:
```typescript
eventBus.subscribe(EVENT_NAMES.EXECUTION_STARTED, (event) => this.onExecutionLifecycle(event));
eventBus.subscribe(EVENT_NAMES.EXECUTION_PAUSED, (event) => this.onExecutionLifecycle(event));
eventBus.subscribe(EVENT_NAMES.EXECUTION_RESUMED, (event) => this.onExecutionLifecycle(event));
eventBus.subscribe(EVENT_NAMES.EXECUTION_COMPLETED, (event) => this.onExecutionLifecycle(event));
eventBus.subscribe(EVENT_NAMES.EXECUTION_FAILED, (event) => this.onExecutionLifecycle(event));
```

Add handler method:
```typescript
private async onExecutionLifecycle(event: DomainEvent): Promise<void> {
  let sliceId: string;
  let sessionId: string;
  let action: "started" | "paused" | "resumed" | "completed" | "failed";
  let resumeCount: number;
  let failureReason: string | undefined;
  let wavesCompleted: number | undefined;
  let totalWaves: number | undefined;

  if (event instanceof ExecutionStartedEvent) {
    sliceId = event.sliceId;
    sessionId = event.sessionId;
    action = "started";
    resumeCount = 0;
  } else if (event instanceof ExecutionPausedEvent) {
    sliceId = event.sliceId;
    sessionId = event.sessionId;
    action = "paused";
    resumeCount = event.resumeCount;
  } else if (event instanceof ExecutionResumedEvent) {
    sliceId = event.sliceId;
    sessionId = event.sessionId;
    action = "resumed";
    resumeCount = event.resumeCount;
  } else if (event instanceof ExecutionCompletedEvent) {
    sliceId = event.sliceId;
    sessionId = event.sessionId;
    action = "completed";
    resumeCount = event.resumeCount;
    wavesCompleted = event.wavesCompleted;
    totalWaves = event.totalWaves;
  } else if (event instanceof ExecutionFailedEvent) {
    sliceId = event.sliceId;
    sessionId = event.sessionId;
    action = "failed";
    resumeCount = event.resumeCount;
    failureReason = event.failureReason;
    wavesCompleted = event.wavesCompleted;
    totalWaves = event.totalWaves;
  } else {
    return;
  }

  const entry: Omit<ExecutionLifecycleEntry, "seq"> = {
    type: "execution-lifecycle",
    sliceId,
    timestamp: event.occurredAt,
    sessionId,
    action,
    resumeCount,
    failureReason,
    wavesCompleted,
    totalWaves,
  };
  await this.journalRepo.append(sliceId, entry);
}
```

- [ ] Step 2: Run existing journal handler tests
**Run:** `npx vitest run src/hexagons/execution/application/`
**Expect:** PASS — no regression

- [ ] Step 3: Commit
**Run:** `git add src/hexagons/execution/application/journal-event-handler.ts && git commit -m "feat(S10/T09): JournalEventHandler subscribes to 5 execution lifecycle events"`

---

### T12: ProcessSignalPauseAdapter

**Create:** `src/hexagons/execution/infrastructure/process-signal-pause.adapter.ts`
**Depends:** T02 (PauseSignalPort)
**Traces to:** AC5

- [ ] Step 1: Implement adapter

**File:** `src/hexagons/execution/infrastructure/process-signal-pause.adapter.ts`
```typescript
import { PauseSignalPort } from "../domain/ports/pause-signal.port";

export class ProcessSignalPauseAdapter extends PauseSignalPort {
  private handler: (() => void) | null = null;

  register(callback: () => void): void {
    this.handler = callback;
    process.on("SIGINT", this.handler);
  }

  dispose(): void {
    if (this.handler) {
      process.removeListener("SIGINT", this.handler);
      this.handler = null;
    }
  }
}
```

- [ ] Step 2: Commit
**Run:** `git add src/hexagons/execution/infrastructure/process-signal-pause.adapter.ts && git commit -m "feat(S10/T12): ProcessSignalPauseAdapter wraps SIGINT"`

---

## Wave 2 (depends on Wave 1)

### T06: ExecutionSessionRepositoryPort + InMemory adapter

**Create:** `src/hexagons/execution/domain/ports/execution-session-repository.port.ts`
**Create:** `src/hexagons/execution/infrastructure/in-memory-execution-session.adapter.ts`
**Depends:** T05 (aggregate)
**Traces to:** AC8

- [ ] Step 1: Implement port

**File:** `src/hexagons/execution/domain/ports/execution-session-repository.port.ts`
```typescript
import type { PersistenceError, Result } from "@kernel";
import type { ExecutionSession } from "../execution-session.aggregate";

export abstract class ExecutionSessionRepositoryPort {
  abstract save(session: ExecutionSession): Promise<Result<void, PersistenceError>>;
  abstract findBySliceId(sliceId: string): Promise<Result<ExecutionSession | null, PersistenceError>>;
  abstract delete(sliceId: string): Promise<Result<void, PersistenceError>>;
}
```

- [ ] Step 2: Implement InMemory adapter

**File:** `src/hexagons/execution/infrastructure/in-memory-execution-session.adapter.ts`
```typescript
import { ok, type PersistenceError, type Result } from "@kernel";
import { ExecutionSession } from "../domain/execution-session.aggregate";
import type { ExecutionSessionProps } from "../domain/execution-session.schemas";
import { ExecutionSessionRepositoryPort } from "../domain/ports/execution-session-repository.port";

export class InMemoryExecutionSessionAdapter extends ExecutionSessionRepositoryPort {
  private store = new Map<string, ExecutionSessionProps>();

  async save(session: ExecutionSession): Promise<Result<void, PersistenceError>> {
    this.store.set(session.sliceId, session.toJSON());
    return ok(undefined);
  }

  async findBySliceId(sliceId: string): Promise<Result<ExecutionSession | null, PersistenceError>> {
    const props = this.store.get(sliceId);
    if (!props) return ok(null);
    return ok(ExecutionSession.reconstitute(props));
  }

  async delete(sliceId: string): Promise<Result<void, PersistenceError>> {
    this.store.delete(sliceId);
    return ok(undefined);
  }

  seed(session: ExecutionSession): void {
    this.store.set(session.sliceId, session.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}
```

- [ ] Step 3: Commit
**Run:** `git add src/hexagons/execution/domain/ports/execution-session-repository.port.ts src/hexagons/execution/infrastructure/in-memory-execution-session.adapter.ts && git commit -m "feat(S10/T06): ExecutionSessionRepositoryPort + InMemory adapter"`

---

### T10: MarkdownExecutionSessionAdapter

**Create:** `src/hexagons/execution/infrastructure/markdown-execution-session.adapter.ts`
**Create:** `src/hexagons/execution/infrastructure/markdown-execution-session.adapter.spec.ts`
**Depends:** T05 (aggregate), T06 (port), T08 (collaborative writer)
**Traces to:** AC8

- [ ] Step 1: Write failing tests

**File:** `src/hexagons/execution/infrastructure/markdown-execution-session.adapter.spec.ts`
```typescript
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ok, type PersistenceError, type Result } from "@kernel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExecutionSession } from "../domain/execution-session.aggregate";
import { MarkdownExecutionSessionAdapter } from "./markdown-execution-session.adapter";

const SLICE_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const SLICE_PATH = "milestones/M04/slices/M04-S01";
const NOW = new Date("2026-03-30T12:00:00Z");

let tmpDir: string;
let adapter: MarkdownExecutionSessionAdapter;

function createSession(): ExecutionSession {
  return ExecutionSession.createNew({
    id: crypto.randomUUID(),
    sliceId: SLICE_ID,
    milestoneId: "milestone-1",
    now: NOW,
  });
}

async function resolvePath(_sliceId: string): Promise<Result<string, PersistenceError>> {
  return ok(SLICE_PATH);
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tff-session-"));
  const sliceDir = join(tmpDir, SLICE_PATH);
  await import("node:fs/promises").then((fs) => fs.mkdir(sliceDir, { recursive: true }));
  adapter = new MarkdownExecutionSessionAdapter(tmpDir, resolvePath);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("MarkdownExecutionSessionAdapter", () => {
  it("save + findBySliceId round-trips session", async () => {
    const session = createSession();
    session.start(NOW);

    await adapter.save(session);
    const result = await adapter.findBySliceId(SLICE_ID);

    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.status).toBe("running");
      expect(result.data.sliceId).toBe(SLICE_ID);
    }
  });

  it("returns null when no session exists", async () => {
    const result = await adapter.findBySliceId("nonexistent");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });

  it("preserves checkpoint-data block", async () => {
    const cpPath = join(tmpDir, SLICE_PATH, "CHECKPOINT.md");
    const checkpointContent = '# Checkpoint\n\n<!-- CHECKPOINT_JSON\n{"id":"cp-1"}\n-->\n';
    await writeFile(cpPath, checkpointContent, "utf-8");

    const session = createSession();
    session.start(NOW);
    await adapter.save(session);

    const content = await readFile(cpPath, "utf-8");
    expect(content).toContain("<!-- CHECKPOINT_JSON");
    expect(content).toContain("<!-- session-data:");
  });

  it("delete removes session block but preserves checkpoint", async () => {
    const cpPath = join(tmpDir, SLICE_PATH, "CHECKPOINT.md");
    const checkpointContent = '# Checkpoint\n\n<!-- CHECKPOINT_JSON\n{"id":"cp-1"}\n-->\n';
    await writeFile(cpPath, checkpointContent, "utf-8");

    const session = createSession();
    session.start(NOW);
    await adapter.save(session);
    await adapter.delete(SLICE_ID);

    const content = await readFile(cpPath, "utf-8");
    expect(content).toContain("<!-- CHECKPOINT_JSON");
    expect(content).not.toContain("<!-- session-data:");
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/infrastructure/markdown-execution-session.adapter.spec.ts`
**Expect:** FAIL — module not found

- [ ] Step 3: Implement MarkdownExecutionSessionAdapter

**File:** `src/hexagons/execution/infrastructure/markdown-execution-session.adapter.ts`
```typescript
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, PersistenceError, type Result } from "@kernel";
import { ExecutionSession } from "../domain/execution-session.aggregate";
import { type ExecutionSessionProps, ExecutionSessionPropsSchema } from "../domain/execution-session.schemas";
import { ExecutionSessionRepositoryPort } from "../domain/ports/execution-session-repository.port";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

const SESSION_DATA_REGEX = /<!-- session-data: ([\s\S]*?) -->/;

export class MarkdownExecutionSessionAdapter extends ExecutionSessionRepositoryPort {
  constructor(
    private readonly basePath: string,
    private readonly resolveSlicePath: (
      sliceId: string,
    ) => Promise<Result<string, PersistenceError>>,
  ) {
    super();
  }

  async save(session: ExecutionSession): Promise<Result<void, PersistenceError>> {
    const pathResult = await this.resolveSlicePath(session.sliceId);
    if (!pathResult.ok) return pathResult;

    const filePath = join(this.basePath, pathResult.data, "CHECKPOINT.md");
    const tmpPath = `${filePath}.session.tmp`;
    const sessionJson = JSON.stringify(session.toJSON());

    try {
      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch {
        content = "";
      }

      const sessionBlock = `<!-- session-data: ${sessionJson} -->`;

      if (SESSION_DATA_REGEX.test(content)) {
        content = content.replace(SESSION_DATA_REGEX, sessionBlock);
      } else {
        content = content.trimEnd() + `\n${sessionBlock}\n`;
      }

      await writeFile(tmpPath, content, "utf-8");
      await rename(tmpPath, filePath);
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Failed to write session: ${filePath}: ${message}`));
    }
  }

  async findBySliceId(sliceId: string): Promise<Result<ExecutionSession | null, PersistenceError>> {
    const pathResult = await this.resolveSlicePath(sliceId);
    if (!pathResult.ok) return pathResult;

    const filePath = join(this.basePath, pathResult.data, "CHECKPOINT.md");
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return ok(null);
      }
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Failed to read session: ${filePath}: ${message}`));
    }

    const match = content.match(SESSION_DATA_REGEX);
    if (!match) return ok(null);

    try {
      const raw = JSON.parse(match[1]);
      raw.createdAt = new Date(raw.createdAt);
      raw.updatedAt = new Date(raw.updatedAt);
      if (raw.startedAt) raw.startedAt = new Date(raw.startedAt);
      if (raw.pausedAt) raw.pausedAt = new Date(raw.pausedAt);
      if (raw.completedAt) raw.completedAt = new Date(raw.completedAt);
      const props = ExecutionSessionPropsSchema.parse(raw);
      return ok(ExecutionSession.reconstitute(props));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Corrupt session data in ${filePath}: ${message}`));
    }
  }

  async delete(sliceId: string): Promise<Result<void, PersistenceError>> {
    const pathResult = await this.resolveSlicePath(sliceId);
    if (!pathResult.ok) return pathResult;

    const filePath = join(this.basePath, pathResult.data, "CHECKPOINT.md");
    try {
      const content = await readFile(filePath, "utf-8");
      const cleaned = content.replace(SESSION_DATA_REGEX, "").trimEnd() + "\n";
      await writeFile(filePath, cleaned, "utf-8");
    } catch (error: unknown) {
      if (isErrnoException(error) && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return ok(undefined);
      }
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Failed to delete session: ${filePath}: ${message}`));
    }
    return ok(undefined);
  }
}
```

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/infrastructure/markdown-execution-session.adapter.spec.ts`
**Expect:** PASS — all tests passing

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/infrastructure/markdown-execution-session.adapter.ts src/hexagons/execution/infrastructure/markdown-execution-session.adapter.spec.ts && git commit -m "feat(S10/T10): MarkdownExecutionSessionAdapter — CHECKPOINT.md session persistence"`

---

## Wave 3 (depends on Wave 2)

### T11: ExecutionCoordinator schemas + use case

**Create:** `src/hexagons/execution/application/execution-coordinator.schemas.ts`
**Create:** `src/hexagons/execution/application/execution-coordinator.use-case.ts`
**Create:** `src/hexagons/execution/application/execution-coordinator.use-case.spec.ts`
**Depends:** T05, T06, T07, T09, T02
**Traces to:** AC1, AC2, AC3, AC5, AC6, AC9

- [ ] Step 1: Create coordinator schemas

**File:** `src/hexagons/execution/application/execution-coordinator.schemas.ts`
```typescript
import { ComplexityTierSchema, IdSchema, ModelProfileNameSchema, ResolvedModelSchema } from "@kernel";
import { z } from "zod";

export const StartExecutionInputSchema = z.object({
  sliceId: IdSchema,
  milestoneId: IdSchema,
  sliceLabel: z.string().min(1),
  sliceTitle: z.string().min(1),
  complexity: ComplexityTierSchema,
  model: ResolvedModelSchema,
  modelProfile: ModelProfileNameSchema,
  workingDirectory: z.string().min(1),
});
export type StartExecutionInput = z.infer<typeof StartExecutionInputSchema>;

export const ExecutionResultSchema = z.object({
  sliceId: IdSchema,
  completedTasks: z.array(IdSchema),
  failedTasks: z.array(IdSchema),
  skippedTasks: z.array(IdSchema),
  wavesCompleted: z.number().int().nonnegative(),
  totalWaves: z.number().int().nonnegative(),
  status: z.enum(["completed", "failed", "paused"]),
  failureReason: z.string().optional(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export const PauseAcknowledgementSchema = z.object({
  sliceId: IdSchema,
  status: z.literal("paused"),
});
export type PauseAcknowledgement = z.infer<typeof PauseAcknowledgementSchema>;
```

- [ ] Step 2: Write failing coordinator tests

**File:** `src/hexagons/execution/application/execution-coordinator.use-case.spec.ts`

This is a large test file. Key test cases (implement all):

```typescript
import { DateProviderPort, InProcessEventBus, ok, SilentLoggerAdapter } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { ExecutionSession } from "../domain/execution-session.aggregate";
import { InMemoryExecutionSessionAdapter } from "../infrastructure/in-memory-execution-session.adapter";
import { InMemoryPauseSignalAdapter } from "../infrastructure/in-memory-pause-signal.adapter";
// ... additional imports for mocked deps
import { ExecutionCoordinator } from "./execution-coordinator.use-case";
import type { StartExecutionInput } from "./execution-coordinator.schemas";

// Use same StubDateProvider and constants pattern as execute-slice.use-case.spec.ts
// Mock the ExecuteSliceUseCase and ReplayJournalUseCase with simple stubs

describe("ExecutionCoordinator", () => {
  describe("startExecution", () => {
    it("creates session, calls execute, returns completed on success");
    it("returns failed when execution errors");
    it("returns paused when signal aborted between waves");
    it("rejects if paused session exists (directs to resume)");
    it("rejects if running session exists");
    it("allows start after failed session");
  });

  describe("pauseExecution", () => {
    it("triggers abort signal on active session (SIGINT path)");
    it("transitions orphaned running session to paused (post-crash path)");
    it("no-ops for already paused session");
    it("errors when no session found");
  });

  describe("resumeExecution", () => {
    it("validates journal, resumes session, calls execute");
    it("fails session on journal inconsistency");
    it("creates synthetic session when only checkpoint exists (crash recovery)");
    it("rejects if session is not paused");
  });
});
```

Full test implementation follows the patterns from `execute-slice.use-case.spec.ts`: StubDateProvider, mock use cases with configurable results, InMemory adapters seeded in `beforeEach`.

- [ ] Step 3: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/application/execution-coordinator.use-case.spec.ts`
**Expect:** FAIL — module not found

- [ ] Step 4: Implement ExecutionCoordinator

**File:** `src/hexagons/execution/application/execution-coordinator.use-case.ts`

Key implementation points:
- Constructor accepts `ExecutionCoordinatorDeps` (per spec)
- `startExecution`: create/load session → validate state → start → register pause signal → execute → handle result (complete/fail/pause) → dispose signal in finally block
- `pauseExecution`: in-memory path (requestPause) + post-crash path (load from repo, confirmPause)
- `resumeExecution`: load session → replay journal → resume → execute → handle result
- Crash recovery in resume: if no session but checkpoint exists → create synthetic paused session

- [ ] Step 5: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/application/execution-coordinator.use-case.spec.ts`
**Expect:** PASS — all tests passing

- [ ] Step 6: Commit
**Run:** `git add src/hexagons/execution/application/execution-coordinator.schemas.ts src/hexagons/execution/application/execution-coordinator.use-case.ts src/hexagons/execution/application/execution-coordinator.use-case.spec.ts && git commit -m "feat(S10/T11): ExecutionCoordinator — start/pause/resume orchestration"`

---

## Wave 4 (depends on Wave 3)

### T13: PI extension tools + registration

**Create:** `src/hexagons/execution/infrastructure/pi/execute-slice.tool.ts`
**Create:** `src/hexagons/execution/infrastructure/pi/pause-execution.tool.ts`
**Create:** `src/hexagons/execution/infrastructure/pi/resume-execution.tool.ts`
**Create:** `src/hexagons/execution/infrastructure/pi/execution.extension.ts`
**Depends:** T11 (coordinator)
**Traces to:** AC1, AC2, AC3

- [ ] Step 1: Create execute tool

**File:** `src/hexagons/execution/infrastructure/pi/execute-slice.tool.ts`
```typescript
import { IdSchema } from "@kernel";
import { createZodTool, textResult } from "@infrastructure/pi";
import { z } from "zod";
import type { ExecutionCoordinator } from "../../application/execution-coordinator.use-case";

const ExecuteSliceSchema = z.object({
  sliceId: IdSchema.describe("Slice ID (e.g., M04-S01)"),
  milestoneId: IdSchema.describe("Milestone ID (e.g., M04)"),
  sliceLabel: z.string().describe("Slice label"),
  sliceTitle: z.string().describe("Slice title"),
  complexity: z.string().describe("Complexity tier: S, F-lite, F-full"),
  model: z.object({
    provider: z.string(),
    modelId: z.string(),
  }).describe("Model configuration"),
  modelProfile: z.string().describe("Model profile name"),
  workingDirectory: z.string().describe("Worktree path"),
});

export function createExecuteSliceTool(coordinator: ExecutionCoordinator) {
  return createZodTool({
    name: "tff_execute_slice",
    label: "TFF Execute Slice",
    description: "Start wave-based task execution for a slice.",
    schema: ExecuteSliceSchema,
    execute: async (params) => {
      const result = await coordinator.startExecution(params);
      if (!result.ok) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify({ ok: true, ...result.data }));
    },
  });
}
```

- [ ] Step 2: Create pause tool

**File:** `src/hexagons/execution/infrastructure/pi/pause-execution.tool.ts`
```typescript
import { IdSchema } from "@kernel";
import { createZodTool, textResult } from "@infrastructure/pi";
import { z } from "zod";
import type { ExecutionCoordinator } from "../../application/execution-coordinator.use-case";

const PauseExecutionSchema = z.object({
  sliceId: IdSchema.describe("Slice ID to pause"),
});

export function createPauseExecutionTool(coordinator: ExecutionCoordinator) {
  return createZodTool({
    name: "tff_pause_execution",
    label: "TFF Pause Execution",
    description: "Pause execution — reconcile state after interruption.",
    schema: PauseExecutionSchema,
    execute: async (params) => {
      const result = await coordinator.pauseExecution(params.sliceId);
      if (!result.ok) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify({ ok: true, ...result.data }));
    },
  });
}
```

- [ ] Step 3: Create resume tool

**File:** `src/hexagons/execution/infrastructure/pi/resume-execution.tool.ts`
```typescript
import { IdSchema } from "@kernel";
import { createZodTool, textResult } from "@infrastructure/pi";
import { z } from "zod";
import type { ExecutionCoordinator } from "../../application/execution-coordinator.use-case";

const ResumeExecutionSchema = z.object({
  sliceId: IdSchema.describe("Slice ID to resume"),
  sliceLabel: z.string().describe("Slice label"),
  sliceTitle: z.string().describe("Slice title"),
  milestoneId: IdSchema.describe("Milestone ID"),
  complexity: z.string().describe("Complexity tier"),
  model: z.object({
    provider: z.string(),
    modelId: z.string(),
  }).describe("Model configuration"),
  modelProfile: z.string().describe("Model profile name"),
  workingDirectory: z.string().describe("Worktree path"),
});

export function createResumeExecutionTool(coordinator: ExecutionCoordinator) {
  return createZodTool({
    name: "tff_resume_execution",
    label: "TFF Resume Execution",
    description: "Resume execution from saved checkpoint.",
    schema: ResumeExecutionSchema,
    execute: async (params) => {
      const result = await coordinator.resumeExecution(params.sliceId, params);
      if (!result.ok) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify({ ok: true, ...result.data }));
    },
  });
}
```

- [ ] Step 4: Create extension registration

**File:** `src/hexagons/execution/infrastructure/pi/execution.extension.ts`
```typescript
import type { ExtensionAPI } from "@infrastructure/pi/pi.types";
import { ExecutionCoordinator } from "../../application/execution-coordinator.use-case";
import type { ExecutionCoordinatorDeps } from "../../application/execution-coordinator.use-case";
import { createExecuteSliceTool } from "./execute-slice.tool";
import { createPauseExecutionTool } from "./pause-execution.tool";
import { createResumeExecutionTool } from "./resume-execution.tool";

export interface ExecutionExtensionDeps extends ExecutionCoordinatorDeps {
  // Coordinator deps cover everything needed
}

export function registerExecutionExtension(api: ExtensionAPI, deps: ExecutionExtensionDeps): void {
  const coordinator = new ExecutionCoordinator(deps);

  api.registerTool(createExecuteSliceTool(coordinator));
  api.registerTool(createPauseExecutionTool(coordinator));
  api.registerTool(createResumeExecutionTool(coordinator));
}
```

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/infrastructure/pi/ && git commit -m "feat(S10/T13): PI extension tools — execute, pause, resume"`

---

## Wave 5 (depends on Wave 4)

### T14: Barrel exports + CLI wiring

**Modify:** `src/hexagons/execution/index.ts`
**Modify:** `src/cli/extension.ts`
**Depends:** all above
**Traces to:** AC1

- [ ] Step 1: Update barrel exports

**File:** `src/hexagons/execution/index.ts` — add exports:
```typescript
// Application -- Coordinator
export type { ExecutionResult, PauseAcknowledgement, StartExecutionInput } from "./application/execution-coordinator.schemas";
export { ExecutionResultSchema, PauseAcknowledgementSchema, StartExecutionInputSchema } from "./application/execution-coordinator.schemas";
export { ExecutionCoordinator } from "./application/execution-coordinator.use-case";
// Domain -- ExecutionSession
export { ExecutionSession } from "./domain/execution-session.aggregate";
export type { ExecutionSessionProps, ExecutionSessionStatus } from "./domain/execution-session.schemas";
export { ExecutionSessionPropsSchema, ExecutionSessionStatusSchema } from "./domain/execution-session.schemas";
// Domain -- ExecutionSession Events
export { ExecutionStartedEvent } from "./domain/events/execution-started.event";
export { ExecutionPausedEvent } from "./domain/events/execution-paused.event";
export { ExecutionResumedEvent } from "./domain/events/execution-resumed.event";
export { ExecutionCompletedEvent } from "./domain/events/execution-completed.event";
export { ExecutionFailedEvent } from "./domain/events/execution-failed.event";
// Domain -- ExecutionSession Ports
export { ExecutionSessionRepositoryPort } from "./domain/ports/execution-session-repository.port";
export { PauseSignalPort } from "./domain/ports/pause-signal.port";
// Domain -- Journal Extension
export type { ExecutionLifecycleEntry } from "./domain/journal-entry.schemas";
export { ExecutionLifecycleEntrySchema } from "./domain/journal-entry.schemas";
// Infrastructure -- ExecutionSession Adapters
export { InMemoryExecutionSessionAdapter } from "./infrastructure/in-memory-execution-session.adapter";
export { InMemoryPauseSignalAdapter } from "./infrastructure/in-memory-pause-signal.adapter";
export { MarkdownExecutionSessionAdapter } from "./infrastructure/markdown-execution-session.adapter";
export { ProcessSignalPauseAdapter } from "./infrastructure/process-signal-pause.adapter";
```

- [ ] Step 2: Wire execution extension in CLI bootstrap

**File:** `src/cli/extension.ts` — add execution extension registration in `createTffExtension`:
```typescript
import { registerExecutionExtension } from "@hexagons/execution/infrastructure/pi/execution.extension";
import { MarkdownExecutionSessionAdapter } from "@hexagons/execution/infrastructure/markdown-execution-session.adapter";
import { ProcessSignalPauseAdapter } from "@hexagons/execution/infrastructure/process-signal-pause.adapter";
```

The coordinator receives `ExecuteSliceUseCase` and `ReplayJournalUseCase` as pre-built dependencies — the extension does NOT construct them. The CLI bootstrap constructs the use cases with their full dependency graph (task repo, wave detection, agent dispatch, worktree, guardrail, overseer, retry policy, metrics, git, journal, checkpoint, event bus) and passes them to the coordinator. Read `cli/extension.ts` to identify where these use cases are already constructed or construct them following the existing pattern.

```typescript
// Inside createTffExtension, after existing extension registrations:
const sessionRepo = new MarkdownExecutionSessionAdapter(
  options.projectRoot,
  resolveSlicePath, // same resolver used by MarkdownCheckpointRepository
);

registerExecutionExtension(api, {
  sessionRepository: sessionRepo,
  pauseSignal: new ProcessSignalPauseAdapter(),
  executeSlice: executeSliceUseCase,   // constructed above with full deps
  replayJournal: replayJournalUseCase, // constructed above with journal repo
  checkpointRepository: checkpointRepo,
  phaseTransition: phaseTransitionPort,
  eventBus,
  dateProvider,
  logger,
});
```

**Critical**: `MarkdownExecutionSessionAdapter` must be used (not InMemory) for crash recovery (AC9) — session state must survive process restarts.

- [ ] Step 3: Run full test suite
**Run:** `npx vitest run`
**Expect:** PASS — all tests passing, no regression

- [ ] Step 4: Commit
**Run:** `git add src/hexagons/execution/index.ts src/cli/extension.ts && git commit -m "feat(S10/T14): barrel exports + CLI execution extension wiring"`

# M04-S01: Checkpoint Entity + Repository -- Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Create the Checkpoint aggregate, domain events, errors, repository port, and adapters (InMemory + Markdown) within a new `execution` hexagon. Enable crash-recovery state persistence for the execution engine.

**Architecture:** Hexagonal (DDD). New `hexagons/execution/` hexagon. Follows established patterns from `hexagons/task/`.

**Tech Stack:** TypeScript, Zod schemas, Vitest, node:fs/promises for file I/O.

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `src/hexagons/execution/domain/checkpoint.schemas.ts` | Zod schemas: ExecutorLogEntrySchema, CheckpointPropsSchema |
| `src/hexagons/execution/domain/checkpoint.schemas.spec.ts` | Schema validation tests |
| `src/hexagons/execution/domain/checkpoint.aggregate.ts` | Checkpoint AggregateRoot with business methods |
| `src/hexagons/execution/domain/checkpoint.aggregate.spec.ts` | Aggregate behavior tests |
| `src/hexagons/execution/domain/checkpoint.builder.ts` | Test builder with faker defaults |
| `src/hexagons/execution/domain/errors/checkpoint-not-found.error.ts` | CheckpointNotFoundError |
| `src/hexagons/execution/domain/errors/invalid-checkpoint-state.error.ts` | InvalidCheckpointStateError |
| `src/hexagons/execution/domain/events/checkpoint-saved.event.ts` | CheckpointSavedEvent with sliceId + waveIndex |
| `src/hexagons/execution/domain/ports/checkpoint-repository.port.ts` | Abstract CheckpointRepositoryPort |
| `src/hexagons/execution/infrastructure/in-memory-checkpoint.repository.ts` | Map-based adapter keyed by sliceId |
| `src/hexagons/execution/infrastructure/in-memory-checkpoint.repository.spec.ts` | InMemory contract + adapter-specific tests |
| `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.ts` | CHECKPOINT.md reader/writer with atomic write |
| `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.spec.ts` | Markdown contract + adapter-specific tests |
| `src/hexagons/execution/infrastructure/checkpoint-repository.contract.spec.ts` | Shared `runContractTests()` function |
| `src/hexagons/execution/index.ts` | Barrel exports |

### Files to Modify

| File | Change |
|------|--------|
| `src/kernel/event-names.ts` | Add `CHECKPOINT_SAVED: "execution.checkpoint-saved"` |
| `src/kernel/event-names.spec.ts` | Update count from 13 to 14 |

---

## Wave 0 (parallel -- no dependencies)

### T01: Add CHECKPOINT_SAVED to kernel EVENT_NAMES

**Files:** Modify `src/kernel/event-names.ts`, Modify `src/kernel/event-names.spec.ts`
**Traces to:** AC13

- [ ] Step 1: In `src/kernel/event-names.ts`, add to `EVENT_NAMES` object:

```typescript
  CHECKPOINT_SAVED: "execution.checkpoint-saved",
```

Add after `WORKFLOW_ESCALATION_RAISED`. Then add to `EventNameSchema` z.enum array:

```typescript
  EVENT_NAMES.CHECKPOINT_SAVED,
```

- [ ] Step 2: In `src/kernel/event-names.spec.ts`, update the count assertion:

```typescript
  it("contains all 14 event names", () => {
    expect(Object.keys(EVENT_NAMES)).toHaveLength(14);
  });
```

- [ ] Step 3: Run `npx vitest run src/kernel/event-names.spec.ts`
- [ ] Step 4: Expect PASS -- 5/5 tests passing
- [ ] Step 5: Commit `feat(S01/T01): add CHECKPOINT_SAVED to kernel EVENT_NAMES`

---

### T02: Create domain errors

**Files:** Create `src/hexagons/execution/domain/errors/checkpoint-not-found.error.ts`, Create `src/hexagons/execution/domain/errors/invalid-checkpoint-state.error.ts`
**Traces to:** supports AC3, AC4

- [ ] Step 1: Create `src/hexagons/execution/domain/errors/checkpoint-not-found.error.ts`:

```typescript
import { BaseDomainError } from "@kernel";

export class CheckpointNotFoundError extends BaseDomainError {
  readonly code = "CHECKPOINT.NOT_FOUND";

  constructor(identifier: string) {
    super(`Checkpoint not found: ${identifier}`, { identifier });
  }
}
```

- [ ] Step 2: Create `src/hexagons/execution/domain/errors/invalid-checkpoint-state.error.ts`:

```typescript
import { BaseDomainError } from "@kernel";

export class InvalidCheckpointStateError extends BaseDomainError {
  readonly code = "CHECKPOINT.INVALID_STATE";

  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
  }
}
```

- [ ] Step 3: Commit `feat(S01/T02): add Checkpoint domain errors`

---

### T03: Write failing checkpoint schema tests

**Files:** Create `src/hexagons/execution/domain/checkpoint.schemas.spec.ts`
**Traces to:** AC1

- [ ] Step 1: Create `src/hexagons/execution/domain/checkpoint.schemas.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  CheckpointPropsSchema,
  ExecutorLogEntrySchema,
} from "./checkpoint.schemas";

describe("ExecutorLogEntrySchema", () => {
  const validEntry = {
    taskId: crypto.randomUUID(),
    agentIdentity: "opus",
    startedAt: new Date(),
    completedAt: null,
  };

  it("parses valid entry", () => {
    expect(ExecutorLogEntrySchema.parse(validEntry)).toEqual(validEntry);
  });

  it("rejects empty agentIdentity", () => {
    expect(() =>
      ExecutorLogEntrySchema.parse({ ...validEntry, agentIdentity: "" }),
    ).toThrow();
  });

  it("accepts non-null completedAt", () => {
    const entry = { ...validEntry, completedAt: new Date() };
    expect(ExecutorLogEntrySchema.parse(entry).completedAt).toBeInstanceOf(Date);
  });

  it("defaults completedAt to null when omitted", () => {
    const { completedAt: _, ...noCompleted } = validEntry;
    expect(ExecutorLogEntrySchema.parse(noCompleted).completedAt).toBeNull();
  });

  it("rejects invalid taskId", () => {
    expect(() =>
      ExecutorLogEntrySchema.parse({ ...validEntry, taskId: "not-uuid" }),
    ).toThrow();
  });
});

describe("CheckpointPropsSchema", () => {
  const validProps = {
    id: crypto.randomUUID(),
    sliceId: crypto.randomUUID(),
    baseCommit: "abc123f",
    currentWaveIndex: 0,
    completedWaves: [] as number[],
    completedTasks: [] as string[],
    executorLog: [] as unknown[],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("parses valid props", () => {
    const result = CheckpointPropsSchema.parse(validProps);
    expect(result.id).toBe(validProps.id);
    expect(result.version).toBe(1);
  });

  it("defaults version to 1", () => {
    const result = CheckpointPropsSchema.parse(validProps);
    expect(result.version).toBe(1);
  });

  it("accepts explicit version", () => {
    const result = CheckpointPropsSchema.parse({ ...validProps, version: 2 });
    expect(result.version).toBe(2);
  });

  it("rejects empty baseCommit", () => {
    expect(() =>
      CheckpointPropsSchema.parse({ ...validProps, baseCommit: "" }),
    ).toThrow();
  });

  it("rejects negative currentWaveIndex", () => {
    expect(() =>
      CheckpointPropsSchema.parse({ ...validProps, currentWaveIndex: -1 }),
    ).toThrow();
  });

  it("rejects non-integer currentWaveIndex", () => {
    expect(() =>
      CheckpointPropsSchema.parse({ ...validProps, currentWaveIndex: 1.5 }),
    ).toThrow();
  });

  it("accepts non-empty executorLog", () => {
    const result = CheckpointPropsSchema.parse({
      ...validProps,
      executorLog: [
        {
          taskId: crypto.randomUUID(),
          agentIdentity: "opus",
          startedAt: new Date(),
          completedAt: null,
        },
      ],
    });
    expect(result.executorLog).toHaveLength(1);
  });

  it("accepts non-empty completedWaves and completedTasks", () => {
    const result = CheckpointPropsSchema.parse({
      ...validProps,
      completedWaves: [0, 1],
      completedTasks: [crypto.randomUUID()],
    });
    expect(result.completedWaves).toEqual([0, 1]);
    expect(result.completedTasks).toHaveLength(1);
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/checkpoint.schemas.spec.ts`
- [ ] Step 3: Expect FAIL -- Cannot find module './checkpoint.schemas'

---

## Wave 1 (depends on Wave 0)

### T04: Implement checkpoint schemas

**Files:** Create `src/hexagons/execution/domain/checkpoint.schemas.ts`
**Traces to:** AC1
**Deps:** T03

- [ ] Step 1: Create `src/hexagons/execution/domain/checkpoint.schemas.ts`:

```typescript
import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const ExecutorLogEntrySchema = z.object({
  taskId: IdSchema,
  agentIdentity: z.string().min(1),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable().default(null),
});
export type ExecutorLogEntry = z.infer<typeof ExecutorLogEntrySchema>;

export const CheckpointPropsSchema = z.object({
  version: z.number().int().default(1),
  id: IdSchema,
  sliceId: IdSchema,
  baseCommit: z.string().min(1),
  currentWaveIndex: z.number().int().min(0),
  completedWaves: z.array(z.number().int()),
  completedTasks: z.array(IdSchema),
  executorLog: z.array(ExecutorLogEntrySchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type CheckpointProps = z.infer<typeof CheckpointPropsSchema>;
export type CheckpointDTO = CheckpointProps;
```

- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/checkpoint.schemas.spec.ts`
- [ ] Step 3: Expect PASS -- all tests passing
- [ ] Step 4: Commit `feat(S01/T04): add Checkpoint schemas`

---

### T05: Create CheckpointSavedEvent

**Files:** Create `src/hexagons/execution/domain/events/checkpoint-saved.event.ts`
**Traces to:** AC11
**Deps:** T01

- [ ] Step 1: Create `src/hexagons/execution/domain/events/checkpoint-saved.event.ts`:

```typescript
import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import { z } from "zod";

const CheckpointSavedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  waveIndex: z.number().int().min(0),
});

type CheckpointSavedEventProps = z.infer<
  typeof CheckpointSavedEventPropsSchema
>;

export class CheckpointSavedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.CHECKPOINT_SAVED;
  readonly sliceId: string;
  readonly waveIndex: number;

  constructor(props: CheckpointSavedEventProps) {
    const parsed = CheckpointSavedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.waveIndex = parsed.waveIndex;
  }
}
```

- [ ] Step 2: Commit `feat(S01/T05): add CheckpointSavedEvent`

---

## Wave 2 (depends on Wave 1)

### T06: Write failing Checkpoint aggregate tests

**Files:** Create `src/hexagons/execution/domain/checkpoint.aggregate.spec.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC11, AC14
**Deps:** T02, T04, T05

- [ ] Step 1: Create `src/hexagons/execution/domain/checkpoint.aggregate.spec.ts`:

```typescript
import { EVENT_NAMES, isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { Checkpoint } from "./checkpoint.aggregate";

describe("Checkpoint", () => {
  const id = crypto.randomUUID();
  const sliceId = crypto.randomUUID();
  const now = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-06-01T00:00:00Z");
  const taskId1 = crypto.randomUUID();
  const taskId2 = crypto.randomUUID();

  describe("createNew", () => {
    it("creates checkpoint with wave 0, empty completedTasks/completedWaves (AC1)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });

      expect(cp.id).toBe(id);
      expect(cp.sliceId).toBe(sliceId);
      expect(cp.baseCommit).toBe("abc123f");
      expect(cp.currentWaveIndex).toBe(0);
      expect(cp.completedWaves).toEqual([]);
      expect(cp.completedTasks).toEqual([]);
      expect(cp.executorLog).toEqual([]);
      expect(cp.createdAt).toEqual(now);
      expect(cp.updatedAt).toEqual(now);
    });

    it("does not emit domain events (no CheckpointCreatedEvent)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      expect(cp.pullEvents()).toEqual([]);
    });

    it("throws on empty baseCommit", () => {
      expect(() =>
        Checkpoint.createNew({ id, sliceId, baseCommit: "", now }),
      ).toThrow();
    });

    it("throws on invalid id", () => {
      expect(() =>
        Checkpoint.createNew({ id: "bad", sliceId, baseCommit: "abc123f", now }),
      ).toThrow();
    });
  });

  describe("reconstitute", () => {
    it("hydrates from props without events", () => {
      const cp = Checkpoint.reconstitute({
        version: 1,
        id,
        sliceId,
        baseCommit: "abc123f",
        currentWaveIndex: 2,
        completedWaves: [0, 1],
        completedTasks: [taskId1],
        executorLog: [
          { taskId: taskId1, agentIdentity: "opus", startedAt: now, completedAt: later },
        ],
        createdAt: now,
        updatedAt: later,
      });

      expect(cp.id).toBe(id);
      expect(cp.currentWaveIndex).toBe(2);
      expect(cp.completedWaves).toEqual([0, 1]);
      expect(cp.completedTasks).toEqual([taskId1]);
      expect(cp.executorLog).toHaveLength(1);
      expect(cp.pullEvents()).toEqual([]);
    });
  });

  describe("recordTaskStart", () => {
    it("adds entry to executorLog", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      const result = cp.recordTaskStart(taskId1, "opus", later);

      expect(isOk(result)).toBe(true);
      expect(cp.executorLog).toHaveLength(1);
      expect(cp.executorLog[0].taskId).toBe(taskId1);
      expect(cp.executorLog[0].agentIdentity).toBe("opus");
      expect(cp.executorLog[0].startedAt).toEqual(later);
      expect(cp.executorLog[0].completedAt).toBeNull();
    });

    it("is idempotent -- second call for same taskId is no-op (AC2)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", later);
      cp.recordTaskStart(taskId1, "opus", later);

      expect(cp.executorLog).toHaveLength(1);
    });

    it("overwrites agentIdentity when called with different identity (AC2)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", later);
      cp.recordTaskStart(taskId1, "sonnet", later);

      expect(cp.executorLog).toHaveLength(1);
      expect(cp.executorLog[0].agentIdentity).toBe("sonnet");
    });

    it("updates updatedAt (AC14)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", later);

      expect(cp.updatedAt).toEqual(later);
    });

    it("does not emit events", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", later);

      expect(cp.pullEvents()).toEqual([]);
    });
  });

  describe("recordTaskComplete", () => {
    it("marks task as completed and adds to completedTasks", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);
      const result = cp.recordTaskComplete(taskId1, later);

      expect(isOk(result)).toBe(true);
      expect(cp.completedTasks).toContain(taskId1);
      expect(cp.executorLog[0].completedAt).toEqual(later);
    });

    it("fails with InvalidCheckpointStateError if task not started (AC3)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      const result = cp.recordTaskComplete(taskId1, later);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("CHECKPOINT.INVALID_STATE");
      }
    });

    it("fails if task already completed", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);
      cp.recordTaskComplete(taskId1, later);
      const result = cp.recordTaskComplete(taskId1, later);

      expect(isErr(result)).toBe(true);
    });

    it("emits CheckpointSavedEvent (AC11)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);
      cp.recordTaskComplete(taskId1, later);

      const events = cp.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.CHECKPOINT_SAVED);
    });

    it("updates updatedAt (AC14)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);
      cp.recordTaskComplete(taskId1, later);

      expect(cp.updatedAt).toEqual(later);
    });
  });

  describe("advanceWave", () => {
    it("increments currentWaveIndex and appends previous to completedWaves (AC4)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      const result = cp.advanceWave(later);

      expect(isOk(result)).toBe(true);
      expect(cp.completedWaves).toEqual([0]);
      expect(cp.currentWaveIndex).toBe(1);
    });

    it("guards against duplicate advance (AC4)", () => {
      const cp = Checkpoint.reconstitute({
        version: 1,
        id,
        sliceId,
        baseCommit: "abc123f",
        currentWaveIndex: 1,
        completedWaves: [0, 1],
        completedTasks: [],
        executorLog: [],
        createdAt: now,
        updatedAt: now,
      });
      const result = cp.advanceWave(later);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("CHECKPOINT.INVALID_STATE");
      }
    });

    it("emits CheckpointSavedEvent (AC11)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.advanceWave(later);

      const events = cp.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.CHECKPOINT_SAVED);
    });

    it("updates updatedAt (AC14)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.advanceWave(later);

      expect(cp.updatedAt).toEqual(later);
    });
  });

  describe("queries", () => {
    it("isTaskCompleted returns correct state (AC5)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);
      cp.recordTaskComplete(taskId1, later);

      expect(cp.isTaskCompleted(taskId1)).toBe(true);
      expect(cp.isTaskCompleted(taskId2)).toBe(false);
    });

    it("isWaveCompleted returns correct state (AC5)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.advanceWave(later);

      expect(cp.isWaveCompleted(0)).toBe(true);
      expect(cp.isWaveCompleted(1)).toBe(false);
    });

    it("isTaskStarted returns correct state (AC5)", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      cp.recordTaskStart(taskId1, "opus", now);

      expect(cp.isTaskStarted(taskId1)).toBe(true);
      expect(cp.isTaskStarted(taskId2)).toBe(false);
    });
  });

  describe("toJSON", () => {
    it("returns a copy of props", () => {
      const cp = Checkpoint.createNew({ id, sliceId, baseCommit: "abc123f", now });
      const json = cp.toJSON();

      expect(json).toEqual({
        version: 1,
        id,
        sliceId,
        baseCommit: "abc123f",
        currentWaveIndex: 0,
        completedWaves: [],
        completedTasks: [],
        executorLog: [],
        createdAt: now,
        updatedAt: now,
      });
    });
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/checkpoint.aggregate.spec.ts`
- [ ] Step 3: Expect FAIL -- Cannot find module './checkpoint.aggregate'

---

## Wave 3 (depends on Wave 2)

### T07: Implement Checkpoint aggregate

**Files:** Create `src/hexagons/execution/domain/checkpoint.aggregate.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC11, AC14
**Deps:** T06

- [ ] Step 1: Create `src/hexagons/execution/domain/checkpoint.aggregate.ts`:

```typescript
import { AggregateRoot, err, ok, type Result } from "@kernel";
import {
  type CheckpointProps,
  CheckpointPropsSchema,
  type ExecutorLogEntry,
} from "./checkpoint.schemas";
import { InvalidCheckpointStateError } from "./errors/invalid-checkpoint-state.error";
import { CheckpointSavedEvent } from "./events/checkpoint-saved.event";

export class Checkpoint extends AggregateRoot<CheckpointProps> {
  private constructor(props: CheckpointProps) {
    super(props, CheckpointPropsSchema);
  }

  // -- Factories --

  static createNew(params: {
    id: string;
    sliceId: string;
    baseCommit: string;
    now: Date;
  }): Checkpoint {
    return new Checkpoint({
      version: 1,
      id: params.id,
      sliceId: params.sliceId,
      baseCommit: params.baseCommit,
      currentWaveIndex: 0,
      completedWaves: [],
      completedTasks: [],
      executorLog: [],
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static reconstitute(props: CheckpointProps): Checkpoint {
    return new Checkpoint(props);
  }

  // -- Getters --

  get id(): string {
    return this.props.id;
  }

  get sliceId(): string {
    return this.props.sliceId;
  }

  get baseCommit(): string {
    return this.props.baseCommit;
  }

  get currentWaveIndex(): number {
    return this.props.currentWaveIndex;
  }

  get completedWaves(): readonly number[] {
    return this.props.completedWaves;
  }

  get completedTasks(): readonly string[] {
    return this.props.completedTasks;
  }

  get executorLog(): readonly ExecutorLogEntry[] {
    return this.props.executorLog;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // -- Business Methods --

  recordTaskStart(
    taskId: string,
    agentIdentity: string,
    now: Date,
  ): Result<void, InvalidCheckpointStateError> {
    const existingIndex = this.props.executorLog.findIndex(
      (e) => e.taskId === taskId,
    );
    if (existingIndex >= 0) {
      this.props.executorLog = this.props.executorLog.map((e, i) =>
        i === existingIndex ? { ...e, agentIdentity } : e,
      );
      this.props.updatedAt = now;
      return ok(undefined);
    }
    this.props.executorLog = [
      ...this.props.executorLog,
      { taskId, agentIdentity, startedAt: now, completedAt: null },
    ];
    this.props.updatedAt = now;
    return ok(undefined);
  }

  recordTaskComplete(
    taskId: string,
    now: Date,
  ): Result<void, InvalidCheckpointStateError> {
    const entry = this.props.executorLog.find((e) => e.taskId === taskId);
    if (!entry) {
      return err(
        new InvalidCheckpointStateError(
          `Cannot complete task ${taskId}: not started`,
          { taskId },
        ),
      );
    }
    if (entry.completedAt !== null) {
      return err(
        new InvalidCheckpointStateError(
          `Cannot complete task ${taskId}: already completed`,
          { taskId },
        ),
      );
    }
    this.props.executorLog = this.props.executorLog.map((e) =>
      e.taskId === taskId ? { ...e, completedAt: now } : e,
    );
    this.props.completedTasks = [...this.props.completedTasks, taskId];
    this.props.updatedAt = now;
    this.addEvent(
      new CheckpointSavedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        sliceId: this.props.sliceId,
        waveIndex: this.props.currentWaveIndex,
      }),
    );
    return ok(undefined);
  }

  advanceWave(now: Date): Result<void, InvalidCheckpointStateError> {
    if (this.props.completedWaves.includes(this.props.currentWaveIndex)) {
      return err(
        new InvalidCheckpointStateError(
          `Cannot advance wave: wave ${this.props.currentWaveIndex} already in completedWaves`,
          { waveIndex: this.props.currentWaveIndex },
        ),
      );
    }
    this.props.completedWaves = [
      ...this.props.completedWaves,
      this.props.currentWaveIndex,
    ];
    this.props.currentWaveIndex += 1;
    this.props.updatedAt = now;
    this.addEvent(
      new CheckpointSavedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        sliceId: this.props.sliceId,
        waveIndex: this.props.currentWaveIndex - 1,
      }),
    );
    return ok(undefined);
  }

  // -- Queries --

  isTaskCompleted(taskId: string): boolean {
    return this.props.completedTasks.includes(taskId);
  }

  isWaveCompleted(waveIndex: number): boolean {
    return this.props.completedWaves.includes(waveIndex);
  }

  isTaskStarted(taskId: string): boolean {
    return this.props.executorLog.some((e) => e.taskId === taskId);
  }
}
```

- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/checkpoint.aggregate.spec.ts`
- [ ] Step 3: Expect PASS -- all tests passing
- [ ] Step 4: Commit `feat(S01/T07): add Checkpoint aggregate`

---

## Wave 4 (depends on Wave 3)

### T08: Create CheckpointBuilder

**Files:** Create `src/hexagons/execution/domain/checkpoint.builder.ts`
**Traces to:** AC12
**Deps:** T07

- [ ] Step 1: Create `src/hexagons/execution/domain/checkpoint.builder.ts`:

```typescript
import { faker } from "@faker-js/faker";
import { Checkpoint } from "./checkpoint.aggregate";
import type { CheckpointProps, ExecutorLogEntry } from "./checkpoint.schemas";

export class CheckpointBuilder {
  private _id: string = faker.string.uuid();
  private _sliceId: string = faker.string.uuid();
  private _baseCommit: string = faker.git.commitSha({ length: 7 });
  private _currentWaveIndex = 0;
  private _completedWaves: number[] = [];
  private _completedTasks: string[] = [];
  private _executorLog: ExecutorLogEntry[] = [];
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withSliceId(sliceId: string): this {
    this._sliceId = sliceId;
    return this;
  }

  withBaseCommit(baseCommit: string): this {
    this._baseCommit = baseCommit;
    return this;
  }

  withCurrentWaveIndex(index: number): this {
    this._currentWaveIndex = index;
    return this;
  }

  withCompletedWaves(waves: number[]): this {
    this._completedWaves = waves;
    return this;
  }

  withCompletedTasks(tasks: string[]): this {
    this._completedTasks = tasks;
    return this;
  }

  withExecutorLog(log: ExecutorLogEntry[]): this {
    this._executorLog = log;
    return this;
  }

  withNow(now: Date): this {
    this._now = now;
    return this;
  }

  build(): Checkpoint {
    return Checkpoint.createNew({
      id: this._id,
      sliceId: this._sliceId,
      baseCommit: this._baseCommit,
      now: this._now,
    });
  }

  buildProps(): CheckpointProps {
    return {
      version: 1,
      id: this._id,
      sliceId: this._sliceId,
      baseCommit: this._baseCommit,
      currentWaveIndex: this._currentWaveIndex,
      completedWaves: this._completedWaves,
      completedTasks: this._completedTasks,
      executorLog: this._executorLog,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
```

- [ ] Step 2: Commit `feat(S01/T08): add CheckpointBuilder`

---

### T09: Create CheckpointRepositoryPort

**Files:** Create `src/hexagons/execution/domain/ports/checkpoint-repository.port.ts`
**Traces to:** supports AC6-AC10
**Deps:** T07

- [ ] Step 1: Create `src/hexagons/execution/domain/ports/checkpoint-repository.port.ts`:

```typescript
import type { PersistenceError, Result } from "@kernel";
import type { Checkpoint } from "../checkpoint.aggregate";

export abstract class CheckpointRepositoryPort {
  abstract save(checkpoint: Checkpoint): Promise<Result<void, PersistenceError>>;
  abstract findBySliceId(
    sliceId: string,
  ): Promise<Result<Checkpoint | null, PersistenceError>>;
  abstract delete(sliceId: string): Promise<Result<void, PersistenceError>>;
}
```

- [ ] Step 2: Commit `feat(S01/T09): add CheckpointRepositoryPort`

---

## Wave 5 (depends on Wave 4)

### T10: Write contract tests + implement InMemoryCheckpointRepository

**Files:** Create `src/hexagons/execution/infrastructure/checkpoint-repository.contract.spec.ts`, Create `src/hexagons/execution/infrastructure/in-memory-checkpoint.repository.ts`, Create `src/hexagons/execution/infrastructure/in-memory-checkpoint.repository.spec.ts`
**Traces to:** AC10
**Deps:** T08, T09

- [ ] Step 1: Create `src/hexagons/execution/infrastructure/checkpoint-repository.contract.spec.ts`:

```typescript
import { isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { CheckpointBuilder } from "../domain/checkpoint.builder";
import type { CheckpointRepositoryPort } from "../domain/ports/checkpoint-repository.port";

export function runContractTests(
  name: string,
  factory: () => CheckpointRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: CheckpointRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findBySliceId roundtrip", async () => {
      const cp = new CheckpointBuilder().build();
      const saveResult = await repo.save(cp);
      expect(isOk(saveResult)).toBe(true);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data?.id).toBe(cp.id);
        expect(findResult.data?.sliceId).toBe(cp.sliceId);
        expect(findResult.data?.baseCommit).toBe(cp.baseCommit);
        expect(findResult.data?.currentWaveIndex).toBe(cp.currentWaveIndex);
        expect([...findResult.data!.completedWaves]).toEqual([...cp.completedWaves]);
        expect([...findResult.data!.completedTasks]).toEqual([...cp.completedTasks]);
      }
    });

    it("save with non-empty executorLog -- roundtrip preserves entries", async () => {
      const cp = new CheckpointBuilder().build();
      const taskId = crypto.randomUUID();
      cp.recordTaskStart(taskId, "opus", new Date());
      await repo.save(cp);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data?.executorLog).toHaveLength(1);
        expect(findResult.data?.executorLog[0].taskId).toBe(taskId);
        expect(findResult.data?.executorLog[0].agentIdentity).toBe("opus");
      }
    });

    it("findBySliceId returns null for missing slice", async () => {
      const result = await repo.findBySliceId(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("save overwrites existing checkpoint for same slice", async () => {
      const cp = new CheckpointBuilder().build();
      await repo.save(cp);

      cp.advanceWave(new Date());
      await repo.save(cp);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data?.currentWaveIndex).toBe(1);
        expect([...findResult.data!.completedWaves]).toEqual([0]);
      }
    });

    it("save after recordTaskComplete persists completedTasks (AC6)", async () => {
      const cp = new CheckpointBuilder().build();
      const taskId = crypto.randomUUID();
      cp.recordTaskStart(taskId, "opus", new Date());
      cp.recordTaskComplete(taskId, new Date());
      await repo.save(cp);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect([...findResult.data!.completedTasks]).toContain(taskId);
      }
    });

    it("save after advanceWave persists completedWaves (AC7)", async () => {
      const cp = new CheckpointBuilder().build();
      cp.advanceWave(new Date());
      cp.advanceWave(new Date());
      await repo.save(cp);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect([...findResult.data!.completedWaves]).toEqual([0, 1]);
        expect(findResult.data?.currentWaveIndex).toBe(2);
      }
    });

    it("delete removes checkpoint", async () => {
      const cp = new CheckpointBuilder().build();
      await repo.save(cp);
      const deleteResult = await repo.delete(cp.sliceId);
      expect(isOk(deleteResult)).toBe(true);

      const findResult = await repo.findBySliceId(cp.sliceId);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).toBeNull();
      }
    });

    it("delete is no-op for missing checkpoint", async () => {
      const result = await repo.delete(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
    });
  });
}
```

- [ ] Step 2: Create `src/hexagons/execution/infrastructure/in-memory-checkpoint.repository.ts`:

```typescript
import { ok, type PersistenceError, type Result } from "@kernel";
import { Checkpoint } from "../domain/checkpoint.aggregate";
import type { CheckpointProps } from "../domain/checkpoint.schemas";
import { CheckpointRepositoryPort } from "../domain/ports/checkpoint-repository.port";

export class InMemoryCheckpointRepository extends CheckpointRepositoryPort {
  private store = new Map<string, CheckpointProps>();

  async save(checkpoint: Checkpoint): Promise<Result<void, PersistenceError>> {
    this.store.set(checkpoint.sliceId, checkpoint.toJSON());
    return ok(undefined);
  }

  async findBySliceId(
    sliceId: string,
  ): Promise<Result<Checkpoint | null, PersistenceError>> {
    const props = this.store.get(sliceId);
    if (!props) return ok(null);
    return ok(Checkpoint.reconstitute(props));
  }

  async delete(sliceId: string): Promise<Result<void, PersistenceError>> {
    this.store.delete(sliceId);
    return ok(undefined);
  }

  seed(checkpoint: Checkpoint): void {
    this.store.set(checkpoint.sliceId, checkpoint.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}
```

- [ ] Step 3: Create `src/hexagons/execution/infrastructure/in-memory-checkpoint.repository.spec.ts`:

```typescript
import { isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { CheckpointBuilder } from "../domain/checkpoint.builder";
import { runContractTests } from "./checkpoint-repository.contract.spec";
import { InMemoryCheckpointRepository } from "./in-memory-checkpoint.repository";

runContractTests(
  "InMemoryCheckpointRepository",
  () => new InMemoryCheckpointRepository(),
);

describe("InMemoryCheckpointRepository -- adapter-specific", () => {
  let repo: InMemoryCheckpointRepository;

  beforeEach(() => {
    repo = new InMemoryCheckpointRepository();
  });

  it("seed() pre-populates store", async () => {
    const cp = new CheckpointBuilder().build();
    repo.seed(cp);

    const result = await repo.findBySliceId(cp.sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data?.id).toBe(cp.id);
    }
  });

  it("reset() clears store", async () => {
    const cp = new CheckpointBuilder().build();
    repo.seed(cp);
    repo.reset();

    const result = await repo.findBySliceId(cp.sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toBeNull();
    }
  });
});
```

- [ ] Step 4: Run `npx vitest run src/hexagons/execution/infrastructure/in-memory-checkpoint.repository.spec.ts`
- [ ] Step 5: Expect PASS -- all contract tests + adapter-specific tests passing
- [ ] Step 6: Commit `feat(S01/T10): add contract tests and InMemoryCheckpointRepository`

---

## Wave 6 (depends on Wave 5)

### T11: Implement MarkdownCheckpointRepository

**Files:** Create `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.ts`, Create `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.spec.ts`
**Traces to:** AC6, AC7, AC8, AC9
**Deps:** T10

- [ ] Step 1: Create `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.ts`:

```typescript
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, PersistenceError, type Result } from "@kernel";
import { Checkpoint } from "../domain/checkpoint.aggregate";
import { type CheckpointProps, CheckpointPropsSchema } from "../domain/checkpoint.schemas";
import { CheckpointRepositoryPort } from "../domain/ports/checkpoint-repository.port";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class MarkdownCheckpointRepository extends CheckpointRepositoryPort {
  constructor(
    private readonly basePath: string,
    private readonly resolveSlicePath: (
      sliceId: string,
    ) => Promise<Result<string, PersistenceError>>,
  ) {
    super();
  }

  async save(checkpoint: Checkpoint): Promise<Result<void, PersistenceError>> {
    const pathResult = await this.resolveSlicePath(checkpoint.sliceId);
    if (!pathResult.ok) return pathResult;

    const filePath = join(this.basePath, pathResult.data, "CHECKPOINT.md");
    const tmpPath = `${filePath}.tmp`;
    const props = checkpoint.toJSON();
    const content = this.renderMarkdown(props);

    try {
      await writeFile(tmpPath, content, "utf-8");
      await rename(tmpPath, filePath);
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(
        new PersistenceError(
          `Failed to write checkpoint: ${filePath}: ${message}`,
        ),
      );
    }
  }

  async findBySliceId(
    sliceId: string,
  ): Promise<Result<Checkpoint | null, PersistenceError>> {
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
      return err(
        new PersistenceError(
          `Failed to read checkpoint: ${filePath}: ${message}`,
        ),
      );
    }

    const jsonMatch = content.match(
      /<!-- CHECKPOINT_JSON\n([\s\S]*?)\n-->/,
    );
    if (!jsonMatch) {
      return err(
        new PersistenceError(
          `Corrupt CHECKPOINT.md: missing JSON comment in ${filePath}`,
        ),
      );
    }

    try {
      const raw = JSON.parse(jsonMatch[1]);
      raw.createdAt = new Date(raw.createdAt);
      raw.updatedAt = new Date(raw.updatedAt);
      for (const entry of raw.executorLog) {
        entry.startedAt = new Date(entry.startedAt);
        if (entry.completedAt !== null) {
          entry.completedAt = new Date(entry.completedAt);
        }
      }
      const props = CheckpointPropsSchema.parse(raw);
      return ok(Checkpoint.reconstitute(props));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(
        new PersistenceError(
          `Corrupt CHECKPOINT.md: invalid JSON in ${filePath}: ${message}`,
        ),
      );
    }
  }

  async delete(sliceId: string): Promise<Result<void, PersistenceError>> {
    const pathResult = await this.resolveSlicePath(sliceId);
    if (!pathResult.ok) return pathResult;

    const filePath = join(this.basePath, pathResult.data, "CHECKPOINT.md");
    try {
      await unlink(filePath);
    } catch (error: unknown) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return ok(undefined);
      }
      const message = error instanceof Error ? error.message : String(error);
      return err(
        new PersistenceError(
          `Failed to delete checkpoint: ${filePath}: ${message}`,
        ),
      );
    }
    return ok(undefined);
  }

  reset(): void {
    // No-op: tests use temp directories with unique sliceIds per test
  }

  private renderMarkdown(props: CheckpointProps): string {
    const completedWavesStr =
      props.completedWaves.length > 0
        ? props.completedWaves.join(", ")
        : "none";

    const logRows = props.executorLog
      .map((e) => {
        const started = e.startedAt.toISOString().slice(11, 16);
        const completed = e.completedAt
          ? e.completedAt.toISOString().slice(11, 16)
          : "---";
        return `| ${e.taskId.slice(0, 8)} | ${e.agentIdentity} | ${started} | ${completed} |`;
      })
      .join("\n");

    const logTable =
      props.executorLog.length > 0
        ? `## Executor Log\n\n| Task | Agent | Started | Completed |\n|------|-------|---------|----------|\n${logRows}`
        : "## Executor Log\n\nNo entries.";

    const json = JSON.stringify(props);

    return [
      `# Checkpoint -- ${props.sliceId.slice(0, 8)}`,
      "",
      `- **Slice:** ${props.sliceId}`,
      `- **Base Commit:** ${props.baseCommit}`,
      `- **Current Wave:** ${props.currentWaveIndex}`,
      `- **Completed Waves:** ${completedWavesStr}`,
      `- **Completed Tasks:** ${props.completedTasks.length}`,
      "",
      logTable,
      "",
      `<!-- CHECKPOINT_JSON`,
      json,
      `-->`,
      "",
    ].join("\n");
  }
}
```

- [ ] Step 2: Create `src/hexagons/execution/infrastructure/markdown-checkpoint.repository.spec.ts`:

```typescript
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isErr, isOk, ok, type PersistenceError, type Result } from "@kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckpointBuilder } from "../domain/checkpoint.builder";
import { runContractTests } from "./checkpoint-repository.contract.spec";
import { MarkdownCheckpointRepository } from "./markdown-checkpoint.repository";

let basePath: string;

beforeAll(async () => {
  basePath = await mkdtemp(join(tmpdir(), "tff-checkpoint-"));
});

afterAll(async () => {
  await rm(basePath, { recursive: true, force: true });
});

function createResolver(
  base: string,
): (sliceId: string) => Promise<Result<string, PersistenceError>> {
  return async (sliceId: string) => {
    const relativePath = `slices/${sliceId}`;
    await mkdir(join(base, relativePath), { recursive: true });
    return ok(relativePath);
  };
}

runContractTests("MarkdownCheckpointRepository", () => {
  const repo = new MarkdownCheckpointRepository(
    basePath,
    createResolver(basePath),
  );
  return repo;
});

describe("MarkdownCheckpointRepository -- adapter-specific", () => {
  it("returns PersistenceError for corrupt CHECKPOINT.md (missing JSON)", async () => {
    const resolver = createResolver(basePath);
    const repo = new MarkdownCheckpointRepository(basePath, resolver);
    const sliceId = crypto.randomUUID();

    const pathResult = await resolver(sliceId);
    if (!pathResult.ok) throw new Error("resolver failed");
    const filePath = join(basePath, pathResult.data, "CHECKPOINT.md");
    await writeFile(filePath, "# Corrupt file\n\nNo JSON here.", "utf-8");

    const result = await repo.findBySliceId(sliceId);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("Corrupt CHECKPOINT.md");
    }
  });

  it("returns PersistenceError for corrupt CHECKPOINT.md (invalid JSON)", async () => {
    const resolver = createResolver(basePath);
    const repo = new MarkdownCheckpointRepository(basePath, resolver);
    const sliceId = crypto.randomUUID();

    const pathResult = await resolver(sliceId);
    if (!pathResult.ok) throw new Error("resolver failed");
    const filePath = join(basePath, pathResult.data, "CHECKPOINT.md");
    await writeFile(
      filePath,
      "# Corrupt\n\n<!-- CHECKPOINT_JSON\n{invalid json\n-->",
      "utf-8",
    );

    const result = await repo.findBySliceId(sliceId);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("invalid JSON");
    }
  });

  it("JSON in HTML comment recoverable via single JSON.parse (AC9)", async () => {
    const resolver = createResolver(basePath);
    const repo = new MarkdownCheckpointRepository(basePath, resolver);
    const cp = new CheckpointBuilder().build();
    const taskId = crypto.randomUUID();
    cp.recordTaskStart(taskId, "opus", new Date());
    await repo.save(cp);

    const findResult = await repo.findBySliceId(cp.sliceId);
    expect(isOk(findResult)).toBe(true);
    if (isOk(findResult)) {
      expect(findResult.data?.id).toBe(cp.id);
      expect(findResult.data?.executorLog[0].taskId).toBe(taskId);
    }
  });
});
```

- [ ] Step 3: Run `npx vitest run src/hexagons/execution/infrastructure/markdown-checkpoint.repository.spec.ts`
- [ ] Step 4: Expect PASS -- all contract tests + adapter-specific tests passing
- [ ] Step 5: Commit `feat(S01/T11): add MarkdownCheckpointRepository`

---

## Wave 7 (depends on Wave 6)

### T12: Create execution hexagon barrel exports

**Files:** Create `src/hexagons/execution/index.ts`
**Traces to:** all ACs (exposes public API)
**Deps:** T07, T08, T09, T10, T11

- [ ] Step 1: Create `src/hexagons/execution/index.ts`:

```typescript
// Domain -- Errors
export { CheckpointNotFoundError } from "./domain/errors/checkpoint-not-found.error";
export { InvalidCheckpointStateError } from "./domain/errors/invalid-checkpoint-state.error";

// Domain -- Events
export { CheckpointSavedEvent } from "./domain/events/checkpoint-saved.event";

// Domain -- Ports
export { CheckpointRepositoryPort } from "./domain/ports/checkpoint-repository.port";

// Domain -- Schemas
export type { CheckpointDTO, CheckpointProps, ExecutorLogEntry } from "./domain/checkpoint.schemas";
export { CheckpointPropsSchema, ExecutorLogEntrySchema } from "./domain/checkpoint.schemas";

// Infrastructure -- Adapters (exported for downstream test wiring)
export { InMemoryCheckpointRepository } from "./infrastructure/in-memory-checkpoint.repository";
```

- [ ] Step 2: Run `npx vitest run src/hexagons/execution/`
- [ ] Step 3: Expect PASS -- all execution hexagon tests passing
- [ ] Step 4: Commit `feat(S01/T12): add execution hexagon barrel exports`

---

## Dependency Graph

```
T01 (EVENT_NAMES) ─────────────────┐
T02 (errors) ──────────────────────┤
T03 (schema tests) ──> T04 (schemas) ──┤
                                    ├──> T06 (agg tests) ──> T07 (aggregate) ──┬──> T08 (builder) ──┐
T05 (event) [deps T01] ───────────┘                                           └──> T09 (port) ─────┤
                                                                                                    ├──> T10 (contract + InMemory)
                                                                                                    │        │
                                                                                                    │        v
                                                                                                    │    T11 (Markdown)
                                                                                                    │        │
                                                                                                    │        v
                                                                                                    └──> T12 (barrel)
```

## Acceptance Criteria Traceability

| AC | Task(s) |
|----|---------|
| AC1: createNew() valid aggregate | T04, T06, T07 |
| AC2: recordTaskStart() idempotent | T06, T07 |
| AC3: recordTaskComplete() fails if not started | T06, T07 |
| AC4: advanceWave() increments + guards | T06, T07 |
| AC5: query methods correct | T06, T07 |
| AC6: save() after recordTaskComplete() persists | T10, T11 |
| AC7: save() after advanceWave() persists | T10, T11 |
| AC8: CHECKPOINT.md roundtrip | T11 |
| AC9: JSON recoverable via single JSON.parse | T11 |
| AC10: Contract tests pass both adapters | T10, T11 |
| AC11: CheckpointSavedEvent emitted | T05, T06, T07 |
| AC12: Builder produces valid instances | T08 |
| AC13: CHECKPOINT_SAVED in EVENT_NAMES | T01 |
| AC14: Business methods update updatedAt | T06, T07 |

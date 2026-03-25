# M02-S01: Task Hexagon — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Build the Task hexagon with a 4-state status machine (TaskStatusVO), dependency tracking (blockedBy), wave index assignment, and the established hexagon pattern from M01-S06/S07.
**Architecture:** Hexagon with `domain/` (subfolders: `events/`, `errors/`, `ports/`) and `infrastructure/`. Barrel export at root. Contract test pattern for adapters.
**Tech Stack:** TypeScript, Zod v4, Vitest, @faker-js/faker

## File Structure

```
src/hexagons/task/
  domain/
    task.schemas.ts                — Zod schemas, types
    task-status.vo.ts              — TaskStatusVO value object with state machine
    task-status.vo.spec.ts         — VO transition tests
    task.aggregate.ts              — Aggregate root
    task.aggregate.spec.ts         — Aggregate tests
    events/
      task-created.event.ts        — Domain event
      task-completed.event.ts      — Domain event
      task-blocked.event.ts        — Domain event
    errors/
      task-not-found.error.ts      — Domain error
      cyclic-dependency.error.ts   — Domain error
    ports/
      task-repository.port.ts      — Abstract repository
    task.builder.ts                — Faker test builder
  infrastructure/
    in-memory-task.repository.ts         — In-memory adapter
    sqlite-task.repository.ts            — SQLite stub
    task-repository.contract.spec.ts     — Contract tests
  index.ts                          — Barrel export
```

---

## Prerequisites

- Kernel base classes available: AggregateRoot, ValueObject, DomainEvent, Result, schemas, errors, EVENT_NAMES
- `InvalidTransitionError` in kernel
- M01-S06/S07 hexagon patterns established

---

## Wave 0 (parallel — no deps)

### T01: Create TaskPropsSchema, TaskStatusSchema, TaskLabelSchema, types
**Files:** Create `src/hexagons/task/domain/task.schemas.ts`
**Traces to:** AC12
**Code:**
```typescript
import { z } from "zod";
import { IdSchema, TimestampSchema } from "@kernel";

export const TaskStatusSchema = z.enum(["open", "in_progress", "closed", "blocked"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskLabelSchema = z.string().regex(/^T\d{2,}$/);
export type TaskLabel = z.infer<typeof TaskLabelSchema>;

export const TaskPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  label: TaskLabelSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  acceptanceCriteria: z.string().default(""),
  filePaths: z.array(z.string()).default([]),
  status: TaskStatusSchema,
  blockedBy: z.array(IdSchema).default([]),
  waveIndex: z.number().int().min(0).nullable().default(null),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type TaskProps = z.infer<typeof TaskPropsSchema>;
export type TaskDTO = TaskProps;
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(m02-s01/T01): add TaskPropsSchema, TaskStatusSchema, TaskLabelSchema`

### T02: Create TaskCreatedEvent, TaskCompletedEvent, TaskBlockedEvent
**Files:** Create `src/hexagons/task/domain/events/task-created.event.ts`, `src/hexagons/task/domain/events/task-completed.event.ts`, `src/hexagons/task/domain/events/task-blocked.event.ts`
**Traces to:** AC1, AC5, AC6
**Code:**
```typescript
// domain/events/task-created.event.ts
import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class TaskCreatedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_CREATED;
}
```
```typescript
// domain/events/task-completed.event.ts
import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class TaskCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_COMPLETED;
}
```
```typescript
// domain/events/task-blocked.event.ts
import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class TaskBlockedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_BLOCKED;
}
```
**Run:** `npx tsc --noEmit`
**Expect:** FAIL — `TASK_CREATED` not yet in EVENT_NAMES (blocked by T04)
**Note:** T02 files can be written in Wave 0 but will only compile after T04. Commit together with T04.

### T03: Create TaskNotFoundError and CyclicDependencyError
**Files:** Create `src/hexagons/task/domain/errors/task-not-found.error.ts`, `src/hexagons/task/domain/errors/cyclic-dependency.error.ts`
**Traces to:** AC18, AC19
**Code:**
```typescript
// domain/errors/task-not-found.error.ts
import { BaseDomainError } from "@kernel";

export class TaskNotFoundError extends BaseDomainError {
  readonly code = "TASK.NOT_FOUND";

  constructor(identifier: string) {
    super(`Task not found: ${identifier}`, { identifier });
  }
}
```
```typescript
// domain/errors/cyclic-dependency.error.ts
import { BaseDomainError } from "@kernel";

export class CyclicDependencyError extends BaseDomainError {
  readonly code = "TASK.CYCLIC_DEPENDENCY";

  constructor(cyclePath: string[]) {
    super(`Cyclic dependency detected: ${cyclePath.join(" -> ")}`, { cyclePath });
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(m02-s01/T03): add TaskNotFoundError and CyclicDependencyError`

### T04: Add TASK_CREATED to kernel EVENT_NAMES + update spec
**Files:** Edit `src/kernel/event-names.ts`, Edit `src/kernel/event-names.spec.ts`
**Traces to:** AC21
**Changes to `event-names.ts`:**
- Add `TASK_CREATED: "task.created",` after `SLICE_STATUS_CHANGED`
- Add `EVENT_NAMES.TASK_CREATED,` to `EventNameSchema` enum array

**Changes to `event-names.spec.ts`:**
- Update count from 11 to 12 in `"contains all 11 event names"`

**Run:** `npx vitest run src/kernel/event-names.spec.ts`
**Expect:** PASS — 5 tests passing (count updated)
**Commit:** `feat(m02-s01/T04): add TASK_CREATED to kernel EVENT_NAMES`

---

## Wave 1 (depends on T01)

### T05: Write failing tests for TaskStatusVO
**Files:** Create `src/hexagons/task/domain/task-status.vo.spec.ts`
**Traces to:** AC2, AC3
**Code:**
```typescript
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@kernel";
import { TaskStatusVO } from "./task-status.vo";

describe("TaskStatusVO", () => {
  describe("valid transitions", () => {
    const validTransitions: [string, string][] = [
      ["open", "in_progress"],
      ["open", "blocked"],
      ["in_progress", "closed"],
      ["blocked", "open"],
      ["blocked", "blocked"],
    ];

    for (const [from, to] of validTransitions) {
      it(`allows ${from} -> ${to}`, () => {
        const vo = TaskStatusVO.create(from as any);
        const result = vo.transitionTo(to as any);

        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data.value).toBe(to);
        }
      });
    }
  });

  describe("invalid transitions", () => {
    const invalidTransitions: [string, string][] = [
      ["open", "closed"],
      ["open", "open"],
      ["in_progress", "open"],
      ["in_progress", "blocked"],
      ["in_progress", "in_progress"],
      ["blocked", "in_progress"],
      ["blocked", "closed"],
      ["closed", "open"],
      ["closed", "in_progress"],
      ["closed", "blocked"],
      ["closed", "closed"],
    ];

    for (const [from, to] of invalidTransitions) {
      it(`rejects ${from} -> ${to}`, () => {
        const vo = TaskStatusVO.create(from as any);
        const result = vo.transitionTo(to as any);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe("DOMAIN.INVALID_TRANSITION");
        }
      });
    }
  });

  describe("canTransitionTo", () => {
    it("returns true for valid transition", () => {
      const vo = TaskStatusVO.create("open");
      expect(vo.canTransitionTo("in_progress")).toBe(true);
    });

    it("returns false for invalid transition", () => {
      const vo = TaskStatusVO.create("open");
      expect(vo.canTransitionTo("closed")).toBe(false);
    });
  });

  describe("immutability", () => {
    it("transitionTo returns a new instance", () => {
      const vo = TaskStatusVO.create("open");
      const result = vo.transitionTo("in_progress");

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBe(vo);
        expect(vo.value).toBe("open");
      }
    });
  });

  describe("equality", () => {
    it("two VOs with same status are equal", () => {
      const a = TaskStatusVO.create("open");
      const b = TaskStatusVO.create("open");
      expect(a.equals(b)).toBe(true);
    });

    it("two VOs with different status are not equal", () => {
      const a = TaskStatusVO.create("open");
      const b = TaskStatusVO.create("blocked");
      expect(a.equals(b)).toBe(false);
    });
  });
});
```
**Run:** `npx vitest run src/hexagons/task/domain/task-status.vo.spec.ts`
**Expect:** FAIL — `Cannot find module './task-status.vo'`

### T06: Implement TaskStatusVO
**Files:** Create `src/hexagons/task/domain/task-status.vo.ts`
**Traces to:** AC2, AC3
**Code:**
```typescript
import {
  InvalidTransitionError,
  ValueObject,
  type Result,
  err,
  ok,
} from "@kernel";
import { z } from "zod";
import { type TaskStatus, TaskStatusSchema } from "./task.schemas";

const TaskStatusVOPropsSchema = z.object({ value: TaskStatusSchema });
type TaskStatusVOProps = z.infer<typeof TaskStatusVOPropsSchema>;

export class TaskStatusVO extends ValueObject<TaskStatusVOProps> {
  private static readonly TRANSITIONS: ReadonlyMap<
    TaskStatus,
    ReadonlySet<TaskStatus>
  > = new Map<TaskStatus, ReadonlySet<TaskStatus>>([
    ["open", new Set(["in_progress", "blocked"])],
    ["in_progress", new Set(["closed"])],
    ["blocked", new Set(["open", "blocked"])],
    // closed is terminal — no transitions
  ]);

  private constructor(props: TaskStatusVOProps) {
    super(props, TaskStatusVOPropsSchema);
  }

  static create(status: TaskStatus): TaskStatusVO {
    return new TaskStatusVO({ value: status });
  }

  get value(): TaskStatus {
    return this.props.value;
  }

  canTransitionTo(target: TaskStatus): boolean {
    const allowed = TaskStatusVO.TRANSITIONS.get(this.props.value);
    return allowed?.has(target) ?? false;
  }

  transitionTo(target: TaskStatus): Result<TaskStatusVO, InvalidTransitionError> {
    if (!this.canTransitionTo(target)) {
      return err(
        new InvalidTransitionError(this.props.value, target, "Task"),
      );
    }
    return ok(TaskStatusVO.create(target));
  }
}
```
**Run:** `npx vitest run src/hexagons/task/domain/task-status.vo.spec.ts`
**Expect:** PASS — all ~20 tests passing
**Commit:** `feat(m02-s01/T06): add TaskStatusVO with 4-state machine`

---

## Wave 2 (depends on T01, T02, T03, T04, T06)

### T07: Write failing tests for Task aggregate
**Files:** Create `src/hexagons/task/domain/task.aggregate.spec.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11
**Code:**
```typescript
import { describe, expect, it } from "vitest";
import { EVENT_NAMES, isErr, isOk } from "@kernel";
import { Task } from "./task.aggregate";

describe("Task", () => {
  const id = crypto.randomUUID();
  const sliceId = crypto.randomUUID();
  const now = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-06-01T00:00:00Z");

  describe("createNew", () => {
    it("creates a valid task with status open", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });

      expect(t.id).toBe(id);
      expect(t.sliceId).toBe(sliceId);
      expect(t.label).toBe("T01");
      expect(t.title).toBe("Schemas");
      expect(t.description).toBe("");
      expect(t.acceptanceCriteria).toBe("");
      expect(t.filePaths).toEqual([]);
      expect(t.status).toBe("open");
      expect(t.blockedBy).toEqual([]);
      expect(t.waveIndex).toBeNull();
      expect(t.createdAt).toEqual(now);
      expect(t.updatedAt).toEqual(now);
    });

    it("accepts optional fields", () => {
      const t = Task.createNew({
        id, sliceId, label: "T01", title: "Schemas",
        description: "Build schemas",
        acceptanceCriteria: "AC1: schemas exist",
        filePaths: ["src/task.schemas.ts"],
        now,
      });
      expect(t.description).toBe("Build schemas");
      expect(t.acceptanceCriteria).toBe("AC1: schemas exist");
      expect(t.filePaths).toEqual(["src/task.schemas.ts"]);
    });

    it("emits TaskCreatedEvent", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      const events = t.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.TASK_CREATED);
      expect(events[0].aggregateId).toBe(id);
    });

    it("throws on invalid label format", () => {
      expect(() =>
        Task.createNew({ id, sliceId, label: "bad", title: "Schemas", now }),
      ).toThrow();
    });

    it("throws on empty title", () => {
      expect(() =>
        Task.createNew({ id, sliceId, label: "T01", title: "", now }),
      ).toThrow();
    });

    it("throws on invalid id", () => {
      expect(() =>
        Task.createNew({ id: "not-a-uuid", sliceId, label: "T01", title: "Schemas", now }),
      ).toThrow();
    });
  });

  describe("start", () => {
    it("transitions open -> in_progress", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      const result = t.start(later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("in_progress");
      expect(t.updatedAt).toEqual(later);
    });

    it("rejects from closed", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.start(now);
      t.complete(now);
      const result = t.start(later);

      expect(isErr(result)).toBe(true);
    });
  });

  describe("complete", () => {
    it("transitions in_progress -> closed, emits TaskCompletedEvent", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.start(now);
      t.pullEvents(); // drain
      const result = t.complete(later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("closed");
      expect(t.updatedAt).toEqual(later);

      const events = t.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.TASK_COMPLETED);
    });

    it("rejects from open", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      const result = t.complete(later);

      expect(isErr(result)).toBe(true);
    });
  });

  describe("block", () => {
    it("transitions open -> blocked, sets blockedBy, emits TaskBlockedEvent", () => {
      const blockerId = crypto.randomUUID();
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.pullEvents(); // drain creation
      const result = t.block([blockerId], later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("blocked");
      expect(t.blockedBy).toEqual([blockerId]);
      expect(t.updatedAt).toEqual(later);

      const events = t.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.TASK_BLOCKED);
    });

    it("on already-blocked task adds to blockedBy (self-transition), no duplicate event", () => {
      const blocker1 = crypto.randomUUID();
      const blocker2 = crypto.randomUUID();
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.block([blocker1], now);
      t.pullEvents(); // drain

      const result = t.block([blocker2], later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("blocked");
      expect(t.blockedBy).toContain(blocker1);
      expect(t.blockedBy).toContain(blocker2);
      expect(t.pullEvents()).toEqual([]);
    });

    it("rejects from in_progress", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.start(now);
      const result = t.block([crypto.randomUUID()], later);

      expect(isErr(result)).toBe(true);
    });
  });

  describe("unblock", () => {
    it("removes blocker; if blockedBy empty, transitions blocked -> open", () => {
      const blockerId = crypto.randomUUID();
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.block([blockerId], now);
      const result = t.unblock(blockerId, later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("open");
      expect(t.blockedBy).toEqual([]);
      expect(t.updatedAt).toEqual(later);
    });

    it("with remaining blockers stays blocked (self-transition)", () => {
      const blocker1 = crypto.randomUUID();
      const blocker2 = crypto.randomUUID();
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.block([blocker1, blocker2], now);
      const result = t.unblock(blocker1, later);

      expect(isOk(result)).toBe(true);
      expect(t.status).toBe("blocked");
      expect(t.blockedBy).toEqual([blocker2]);
    });

    it("rejects from non-blocked status", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      const result = t.unblock(crypto.randomUUID(), later);

      expect(isErr(result)).toBe(true);
    });
  });

  describe("assignToWave", () => {
    it("sets waveIndex and updates updatedAt", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      t.assignToWave(2, later);

      expect(t.waveIndex).toBe(2);
      expect(t.updatedAt).toEqual(later);
    });
  });

  describe("reconstitute", () => {
    it("hydrates from props without emitting events", () => {
      const props = {
        id, sliceId, label: "T01", title: "Schemas", description: "",
        acceptanceCriteria: "", filePaths: [] as string[],
        status: "open" as const, blockedBy: [] as string[], waveIndex: null,
        createdAt: now, updatedAt: now,
      };
      const t = Task.reconstitute(props);

      expect(t.id).toBe(id);
      expect(t.label).toBe("T01");
      expect(t.pullEvents()).toEqual([]);
    });

    it("throws on invalid props", () => {
      expect(() =>
        Task.reconstitute({
          id: "not-a-uuid", sliceId, label: "T01", title: "Schemas",
          description: "", acceptanceCriteria: "", filePaths: [],
          status: "open" as const, blockedBy: [], waveIndex: null,
          createdAt: now, updatedAt: now,
        }),
      ).toThrow();
    });
  });

  describe("toJSON", () => {
    it("returns a copy of props", () => {
      const t = Task.createNew({ id, sliceId, label: "T01", title: "Schemas", now });
      const json = t.toJSON();

      expect(json).toEqual({
        id, sliceId, label: "T01", title: "Schemas", description: "",
        acceptanceCriteria: "", filePaths: [],
        status: "open", blockedBy: [], waveIndex: null,
        createdAt: now, updatedAt: now,
      });
    });
  });
});
```
**Run:** `npx vitest run src/hexagons/task/domain/task.aggregate.spec.ts`
**Expect:** FAIL — `Cannot find module './task.aggregate'`

### T08: Implement Task aggregate
**Files:** Create `src/hexagons/task/domain/task.aggregate.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11
**Code:**
```typescript
import {
  AggregateRoot,
  type Id,
  type InvalidTransitionError,
  type Result,
} from "@kernel";
import { TaskCreatedEvent } from "./events/task-created.event";
import { TaskCompletedEvent } from "./events/task-completed.event";
import { TaskBlockedEvent } from "./events/task-blocked.event";
import { TaskStatusVO } from "./task-status.vo";
import {
  type TaskProps,
  TaskPropsSchema,
  type TaskStatus,
} from "./task.schemas";

export class Task extends AggregateRoot<TaskProps> {
  private constructor(props: TaskProps) {
    super(props, TaskPropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get sliceId(): string {
    return this.props.sliceId;
  }

  get label(): string {
    return this.props.label;
  }

  get title(): string {
    return this.props.title;
  }

  get description(): string {
    return this.props.description;
  }

  get acceptanceCriteria(): string {
    return this.props.acceptanceCriteria;
  }

  get filePaths(): readonly string[] {
    return this.props.filePaths;
  }

  get status(): TaskStatus {
    return this.props.status;
  }

  get blockedBy(): readonly string[] {
    return this.props.blockedBy;
  }

  get waveIndex(): number | null {
    return this.props.waveIndex;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  static createNew(params: {
    id: Id;
    sliceId: Id;
    label: string;
    title: string;
    description?: string;
    acceptanceCriteria?: string;
    filePaths?: string[];
    now: Date;
  }): Task {
    const task = new Task({
      id: params.id,
      sliceId: params.sliceId,
      label: params.label,
      title: params.title,
      description: params.description ?? "",
      acceptanceCriteria: params.acceptanceCriteria ?? "",
      filePaths: params.filePaths ?? [],
      status: "open",
      blockedBy: [],
      waveIndex: null,
      createdAt: params.now,
      updatedAt: params.now,
    });
    task.addEvent(
      new TaskCreatedEvent({
        id: crypto.randomUUID(),
        aggregateId: params.id,
        occurredAt: params.now,
      }),
    );
    return task;
  }

  start(now: Date): Result<void, InvalidTransitionError> {
    return this.applyTransition("in_progress", now);
  }

  complete(now: Date): Result<void, InvalidTransitionError> {
    const result = this.applyTransition("closed", now);
    if (result.ok) {
      this.addEvent(
        new TaskCompletedEvent({
          id: crypto.randomUUID(),
          aggregateId: this.props.id,
          occurredAt: now,
        }),
      );
    }
    return result;
  }

  block(blockerIds: string[], now: Date): Result<void, InvalidTransitionError> {
    const isSelfTransition = this.props.status === "blocked";
    const result = this.applyTransition("blocked", now);
    if (result.ok) {
      this.props.blockedBy = [...new Set([...this.props.blockedBy, ...blockerIds])];
      if (!isSelfTransition) {
        this.addEvent(
          new TaskBlockedEvent({
            id: crypto.randomUUID(),
            aggregateId: this.props.id,
            occurredAt: now,
          }),
        );
      }
    }
    return result;
  }

  unblock(blockerId: string, now: Date): Result<void, InvalidTransitionError> {
    if (this.props.status !== "blocked") {
      return this.applyTransition("open", now); // will fail with InvalidTransitionError
    }
    this.props.blockedBy = this.props.blockedBy.filter((id) => id !== blockerId);
    this.props.updatedAt = now;
    if (this.props.blockedBy.length === 0) {
      this.props.status = "open";
    }
    return { ok: true, data: undefined };
  }

  assignToWave(waveIndex: number, now: Date): void {
    this.props.waveIndex = waveIndex;
    this.props.updatedAt = now;
  }

  static reconstitute(props: TaskProps): Task {
    return new Task(props);
  }

  private applyTransition(
    target: TaskStatus,
    now: Date,
  ): Result<void, InvalidTransitionError> {
    const currentVO = TaskStatusVO.create(this.props.status);
    const result = currentVO.transitionTo(target);

    if (!result.ok) {
      return result;
    }

    this.props.status = result.data.value;
    this.props.updatedAt = now;
    return { ok: true, data: undefined };
  }
}
```
**Run:** `npx vitest run src/hexagons/task/domain/task.aggregate.spec.ts`
**Expect:** PASS — all ~20 tests passing
**Commit:** `feat(m02-s01/T08): add Task aggregate with tests`

---

## Wave 3 (depends on T08 — parallel)

### T09: Create TaskRepositoryPort
**Files:** Create `src/hexagons/task/domain/ports/task-repository.port.ts`
**Traces to:** AC13, AC14
**Code:**
```typescript
import type { Id, PersistenceError, Result } from "@kernel";
import type { Task } from "../task.aggregate";

export abstract class TaskRepositoryPort {
  abstract save(task: Task): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Task | null, PersistenceError>>;
  abstract findByLabel(label: string): Promise<Result<Task | null, PersistenceError>>;
  abstract findBySliceId(sliceId: Id): Promise<Result<Task[], PersistenceError>>;
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(m02-s01/T09): add TaskRepositoryPort`

### T10: Create TaskBuilder
**Files:** Create `src/hexagons/task/domain/task.builder.ts`
**Traces to:** AC17
**Code:**
```typescript
import { faker } from "@faker-js/faker";
import { Task } from "./task.aggregate";
import type { TaskProps, TaskStatus } from "./task.schemas";

export class TaskBuilder {
  private _id: string = faker.string.uuid();
  private _sliceId: string = faker.string.uuid();
  private _label = "T01";
  private _title: string = faker.lorem.words(3);
  private _description: string = faker.lorem.sentence();
  private _acceptanceCriteria: string = faker.lorem.sentence();
  private _filePaths: string[] = [];
  private _status: TaskStatus = "open";
  private _blockedBy: string[] = [];
  private _waveIndex: number | null = null;
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withSliceId(sliceId: string): this {
    this._sliceId = sliceId;
    return this;
  }

  withLabel(label: string): this {
    this._label = label;
    return this;
  }

  withTitle(title: string): this {
    this._title = title;
    return this;
  }

  withDescription(description: string): this {
    this._description = description;
    return this;
  }

  withAcceptanceCriteria(ac: string): this {
    this._acceptanceCriteria = ac;
    return this;
  }

  withFilePaths(paths: string[]): this {
    this._filePaths = paths;
    return this;
  }

  withStatus(status: TaskStatus): this {
    this._status = status;
    return this;
  }

  withBlockedBy(ids: string[]): this {
    this._blockedBy = ids;
    return this;
  }

  withWaveIndex(index: number): this {
    this._waveIndex = index;
    return this;
  }

  build(): Task {
    return Task.createNew({
      id: this._id,
      sliceId: this._sliceId,
      label: this._label,
      title: this._title,
      description: this._description,
      acceptanceCriteria: this._acceptanceCriteria,
      filePaths: this._filePaths,
      now: this._now,
    });
  }

  buildProps(): TaskProps {
    return {
      id: this._id,
      sliceId: this._sliceId,
      label: this._label,
      title: this._title,
      description: this._description,
      acceptanceCriteria: this._acceptanceCriteria,
      filePaths: this._filePaths,
      status: this._status,
      blockedBy: this._blockedBy,
      waveIndex: this._waveIndex,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(m02-s01/T10): add TaskBuilder with Faker defaults`

---

## Wave 4 (depends on T09, T10 — parallel)

### T11: Implement InMemoryTaskRepository
**Files:** Create `src/hexagons/task/infrastructure/in-memory-task.repository.ts`
**Traces to:** AC13, AC14, AC15
**Code:**
```typescript
import { type Id, PersistenceError, type Result, err, ok } from "@kernel";
import { Task } from "../domain/task.aggregate";
import { TaskRepositoryPort } from "../domain/ports/task-repository.port";
import type { TaskProps } from "../domain/task.schemas";

export class InMemoryTaskRepository extends TaskRepositoryPort {
  private store = new Map<string, TaskProps>();

  async save(task: Task): Promise<Result<void, PersistenceError>> {
    const props = task.toJSON();
    for (const [existingId, existingProps] of this.store) {
      if (
        existingId !== props.id &&
        existingProps.label === props.label &&
        existingProps.sliceId === props.sliceId
      ) {
        return err(
          new PersistenceError(
            `Label uniqueness violated: task '${props.label}' already exists in slice '${props.sliceId}'`,
          ),
        );
      }
    }
    this.store.set(props.id, props);
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Task | null, PersistenceError>> {
    const props = this.store.get(id);
    if (!props) return ok(null);
    return ok(Task.reconstitute(props));
  }

  async findByLabel(label: string): Promise<Result<Task | null, PersistenceError>> {
    for (const props of this.store.values()) {
      if (props.label === label) {
        return ok(Task.reconstitute(props));
      }
    }
    return ok(null);
  }

  async findBySliceId(sliceId: Id): Promise<Result<Task[], PersistenceError>> {
    const results: Task[] = [];
    for (const props of this.store.values()) {
      if (props.sliceId === sliceId) {
        results.push(Task.reconstitute(props));
      }
    }
    return ok(results);
  }

  seed(task: Task): void {
    this.store.set(task.id, task.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(m02-s01/T11): add InMemoryTaskRepository`

### T12: Create SqliteTaskRepository stub
**Files:** Create `src/hexagons/task/infrastructure/sqlite-task.repository.ts`
**Traces to:** AC16
**Code:**
```typescript
import type { Id, PersistenceError, Result } from "@kernel";
import type { Task } from "../domain/task.aggregate";
import { TaskRepositoryPort } from "../domain/ports/task-repository.port";

export class SqliteTaskRepository extends TaskRepositoryPort {
  save(_task: Task): Promise<Result<void, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findById(_id: Id): Promise<Result<Task | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findByLabel(_label: string): Promise<Result<Task | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findBySliceId(_sliceId: Id): Promise<Result<Task[], PersistenceError>> {
    throw new Error("Not implemented");
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(m02-s01/T12): add SqliteTaskRepository stub`

---

## Wave 5 (depends on T11)

### T13: Write and run contract test suite
**Files:** Create `src/hexagons/task/infrastructure/task-repository.contract.spec.ts`
**Traces to:** AC13, AC14, AC15
**Code:**
```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { isErr, isOk } from "@kernel";
import { TaskBuilder } from "../domain/task.builder";
import type { TaskRepositoryPort } from "../domain/ports/task-repository.port";
import { InMemoryTaskRepository } from "./in-memory-task.repository";

function runContractTests(
  name: string,
  factory: () => TaskRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: TaskRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findById roundtrip", async () => {
      const task = new TaskBuilder().build();
      const saveResult = await repo.save(task);
      expect(isOk(saveResult)).toBe(true);

      const findResult = await repo.findById(task.id);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data!.id).toBe(task.id);
        expect(findResult.data!.label).toBe(task.label);
        expect(findResult.data!.title).toBe(task.title);
      }
    });

    it("save + findByLabel roundtrip", async () => {
      const task = new TaskBuilder().withLabel("T05").build();
      await repo.save(task);

      const result = await repo.findByLabel("T05");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBeNull();
        expect(result.data!.id).toBe(task.id);
      }
    });

    it("findBySliceId returns matching tasks", async () => {
      const sliceId = crypto.randomUUID();
      const t1 = new TaskBuilder().withSliceId(sliceId).withLabel("T01").build();
      const t2 = new TaskBuilder().withSliceId(sliceId).withLabel("T02").build();
      const t3 = new TaskBuilder().withLabel("T03").build(); // different slice
      await repo.save(t1);
      await repo.save(t2);
      await repo.save(t3);

      const result = await repo.findBySliceId(sliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(2);
      }
    });

    it("findBySliceId returns empty array when none match", async () => {
      const result = await repo.findBySliceId(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([]);
      }
    });

    it("findById returns null for unknown id", async () => {
      const result = await repo.findById(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("findByLabel returns null for unknown label", async () => {
      const result = await repo.findByLabel("T99");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("label uniqueness: rejects duplicate label within same slice", async () => {
      const sliceId = crypto.randomUUID();
      const t1 = new TaskBuilder().withSliceId(sliceId).withLabel("T01").build();
      const t2 = new TaskBuilder().withSliceId(sliceId).withLabel("T01").build();
      await repo.save(t1);

      const result = await repo.save(t2);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("Label uniqueness");
      }
    });

    it("label uniqueness: allows same label in different slices", async () => {
      const t1 = new TaskBuilder().withSliceId(crypto.randomUUID()).withLabel("T01").build();
      const t2 = new TaskBuilder().withSliceId(crypto.randomUUID()).withLabel("T01").build();
      await repo.save(t1);

      const result = await repo.save(t2);
      expect(isOk(result)).toBe(true);
    });

    it("save allows updating an existing task", async () => {
      const task = new TaskBuilder().build();
      await repo.save(task);

      task.start(new Date());
      const result = await repo.save(task);
      expect(isOk(result)).toBe(true);
    });
  });
}

runContractTests(
  "InMemoryTaskRepository",
  () => new InMemoryTaskRepository(),
);
```
**Run:** `npx vitest run src/hexagons/task/infrastructure/task-repository.contract.spec.ts`
**Expect:** PASS — 9/9 tests passing
**Commit:** `test(m02-s01/T13): add task repository contract test suite`

---

## Wave 6 (depends on all)

### T14: Create barrel export and verify
**Files:** Create `src/hexagons/task/index.ts`
**Traces to:** AC20, AC22, AC23
**Code:**
```typescript
export type { TaskDTO, TaskStatus, TaskLabel } from "./domain/task.schemas";
export { TaskPropsSchema, TaskStatusSchema, TaskLabelSchema } from "./domain/task.schemas";
export { TaskRepositoryPort } from "./domain/ports/task-repository.port";
export { TaskCreatedEvent } from "./domain/events/task-created.event";
export { TaskCompletedEvent } from "./domain/events/task-completed.event";
export { TaskBlockedEvent } from "./domain/events/task-blocked.event";
export { TaskNotFoundError } from "./domain/errors/task-not-found.error";
export { CyclicDependencyError } from "./domain/errors/cyclic-dependency.error";
// Task aggregate and TaskStatusVO are NOT exported (internal to hexagon)
```
**Run:** `npx biome check src/hexagons/task/ && npx vitest run src/hexagons/task/`
**Expect:** PASS — biome clean, all tests pass (VO + aggregate + contract)
**Commit:** `feat(m02-s01/T14): add task hexagon barrel export`

---

## AC Traceability

| AC | Tasks |
|---|---|
| AC1: createNew() creates task with status open + emits TaskCreatedEvent | T01, T02, T04, T07, T08 |
| AC2: TaskStatusVO enforces all 5 valid transitions | T05, T06 |
| AC3: TaskStatusVO rejects invalid transitions | T05, T06 |
| AC4: start() transitions open -> in_progress | T07, T08 |
| AC5: complete() transitions in_progress -> closed, emits TaskCompletedEvent | T02, T07, T08 |
| AC6: block() transitions open -> blocked, sets blockedBy, emits TaskBlockedEvent | T02, T07, T08 |
| AC7: block() on already-blocked adds to blockedBy, no duplicate event | T07, T08 |
| AC8: unblock() removes blocker; if empty, transitions blocked -> open | T07, T08 |
| AC9: unblock() with remaining blockers stays blocked | T07, T08 |
| AC10: assignToWave() sets waveIndex and updates updatedAt | T07, T08 |
| AC11: reconstitute() hydrates from props without events | T07, T08 |
| AC12: Label validation enforces T{nn} format via Zod regex | T01, T07 |
| AC13: Label uniqueness scoped to slice in repository | T09, T11, T13 |
| AC14: InMemoryTaskRepository passes all contract tests | T11, T13 |
| AC15: InMemoryTaskRepository has seed() and reset() helpers | T11 |
| AC16: SqliteTaskRepository stub exists with correct interface | T12 |
| AC17: TaskBuilder produces valid Tasks with Faker defaults and supports chaining | T10 |
| AC18: CyclicDependencyError has code TASK.CYCLIC_DEPENDENCY and includes cycle path | T03 |
| AC19: TaskNotFoundError has code TASK.NOT_FOUND | T03 |
| AC20: Barrel exports only ports, events, schemas, DTOs, and errors | T14 |
| AC21: Kernel EVENT_NAMES updated with TASK_CREATED | T04 |
| AC22: All tests pass | T05, T06, T07, T08, T13 |
| AC23: biome check passes on all new files | T14 |

## Wave Summary

| Wave | Tasks | Parallelizable |
|------|-------|---------------|
| 0 | T01, T02, T03, T04 | yes (4 parallel, T02 compiles after T04) |
| 1 | T05, T06 | no (sequential TDD) |
| 2 | T07, T08 | no (sequential TDD) |
| 3 | T09, T10 | yes (2 parallel) |
| 4 | T11, T12 | yes (2 parallel) |
| 5 | T13 | no |
| 6 | T14 | no |

# M02-S01: Task Hexagon

## Problem

The fourth and final entity hexagon in the domain stack. Task represents individual units of work within a slice, with a 4-state status machine (open, in_progress, closed, blocked), dependency tracking via `blockedBy`, and wave index assignment for parallel execution planning.

## Approach

Mirror the S06/S07 hexagon structure exactly. State machine logic encapsulated in `TaskStatusVO` (a `ValueObject` subclass). `InvalidTransitionError` reused from kernel. `CyclicDependencyError` is a new domain error specific to the task hexagon (used by wave detection in S02). SQLite adapter stubbed as in prior slices.

## Design

### Directory Structure

```
src/hexagons/task/
  domain/
    task.schemas.ts
    task-status.vo.ts
    task-status.vo.spec.ts
    task.aggregate.ts
    task.aggregate.spec.ts
    events/
      task-completed.event.ts
      task-blocked.event.ts
    errors/
      task-not-found.error.ts
      cyclic-dependency.error.ts
    ports/
      task-repository.port.ts
    task.builder.ts
  infrastructure/
    in-memory-task.repository.ts
    sqlite-task.repository.ts
    task-repository.contract.spec.ts
  index.ts
```

### Schemas

```typescript
// domain/task.schemas.ts
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

### TaskStatusVO

```typescript
// domain/task-status.vo.ts
export class TaskStatusVO extends ValueObject<{ value: TaskStatus }> {
  private static readonly TRANSITIONS: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>>;
  // open -> in_progress, blocked
  // in_progress -> closed
  // blocked -> open, blocked (self-transition for blockedBy list updates)
  // closed -> (terminal, no transitions)

  static create(status: TaskStatus): TaskStatusVO;
  get value(): TaskStatus;
  canTransitionTo(target: TaskStatus): boolean;
  transitionTo(target: TaskStatus): Result<TaskStatusVO, InvalidTransitionError>;
}
```

5 valid transitions total. Self-transition `blocked -> blocked` is allowed to update the blockedBy list without changing status.

### Aggregate Root

```typescript
// domain/task.aggregate.ts
export class Task extends AggregateRoot<TaskProps> {
  private constructor(props: TaskProps) {
    super(props, TaskPropsSchema);
  }

  // --- Accessors ---
  get id(): string;
  get sliceId(): string;
  get label(): string;
  get title(): string;
  get description(): string;
  get acceptanceCriteria(): string;
  get filePaths(): readonly string[];
  get status(): TaskStatus;
  get blockedBy(): readonly string[];
  get waveIndex(): number | null;
  get createdAt(): Date;
  get updatedAt(): Date;

  // --- Factory ---
  static createNew(params: {
    id: Id; sliceId: Id; label: string;
    title: string; description?: string;
    acceptanceCriteria?: string; filePaths?: string[];
    now: Date;
  }): Task;
  // Sets status to "open", emits TaskCreatedEvent

  // --- Commands ---
  start(now: Date): Result<void, InvalidTransitionError>;
  // open -> in_progress

  complete(now: Date): Result<void, InvalidTransitionError>;
  // in_progress -> closed, emits TaskCompletedEvent

  block(blockerIds: string[], now: Date): Result<void, InvalidTransitionError>;
  // open -> blocked, sets blockedBy, emits TaskBlockedEvent
  // Also handles blocked -> blocked (add more blockers)

  unblock(blockerId: string, now: Date): Result<void, InvalidTransitionError>;
  // Removes blockerId from blockedBy
  // If blockedBy becomes empty: blocked -> open
  // If blockedBy still has entries: stays blocked (self-transition)

  assignToWave(waveIndex: number, now: Date): void;
  // Sets waveIndex, updates updatedAt

  // --- Reconstitution ---
  static reconstitute(props: TaskProps): Task;
}
```

### Domain Events

```typescript
// domain/events/task-completed.event.ts
export class TaskCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_COMPLETED;
}

// domain/events/task-blocked.event.ts
export class TaskBlockedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_BLOCKED;
}
```

Note: `TASK_CREATED`, `TASK_COMPLETED`, and `TASK_BLOCKED` must be added to kernel `EVENT_NAMES`.

### Domain Errors

```typescript
// domain/errors/task-not-found.error.ts
export class TaskNotFoundError extends BaseDomainError {
  readonly code = "TASK.NOT_FOUND";
  constructor(identifier: string) {
    super(`Task not found: ${identifier}`, { identifier });
  }
}

// domain/errors/cyclic-dependency.error.ts
export class CyclicDependencyError extends BaseDomainError {
  readonly code = "TASK.CYCLIC_DEPENDENCY";
  constructor(cyclePath: string[]) {
    super(`Cyclic dependency detected: ${cyclePath.join(" -> ")}`, { cyclePath });
  }
}
```

### Repository Port

```typescript
// domain/ports/task-repository.port.ts
export abstract class TaskRepositoryPort {
  abstract save(task: Task): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Task | null, PersistenceError>>;
  abstract findByLabel(label: string): Promise<Result<Task | null, PersistenceError>>;
  abstract findBySliceId(sliceId: Id): Promise<Result<Task[], PersistenceError>>;
}
```

Label uniqueness scoped to slice: `save()` rejects if a different task in the same slice has the same label.

### InMemoryTaskRepository

```typescript
// infrastructure/in-memory-task.repository.ts
export class InMemoryTaskRepository extends TaskRepositoryPort {
  private store = new Map<string, TaskProps>();
  seed(task: Task): void;
  reset(): void;
}
```

### SqliteTaskRepository (Stub)

```typescript
// infrastructure/sqlite-task.repository.ts
export class SqliteTaskRepository extends TaskRepositoryPort {
  // All methods throw "Not implemented"
}
```

### Builder

```typescript
// domain/task.builder.ts
export class TaskBuilder {
  withId(id: string): this;
  withSliceId(sliceId: string): this;
  withLabel(label: string): this;
  withTitle(title: string): this;
  withDescription(description: string): this;
  withAcceptanceCriteria(ac: string): this;
  withFilePaths(paths: string[]): this;
  withStatus(status: TaskStatus): this;
  withBlockedBy(ids: string[]): this;
  withWaveIndex(index: number): this;
  build(): Task;         // uses createNew() — always status "open"
  buildProps(): TaskProps; // raw props for reconstitution tests
}
```

### Barrel Export

```typescript
// index.ts
export type { TaskDTO, TaskStatus, TaskLabel } from "./domain/task.schemas";
export { TaskPropsSchema, TaskStatusSchema, TaskLabelSchema } from "./domain/task.schemas";
export { TaskRepositoryPort } from "./domain/ports/task-repository.port";
export { TaskCompletedEvent } from "./domain/events/task-completed.event";
export { TaskBlockedEvent } from "./domain/events/task-blocked.event";
export { TaskNotFoundError } from "./domain/errors/task-not-found.error";
export { CyclicDependencyError } from "./domain/errors/cyclic-dependency.error";
// Task aggregate and TaskStatusVO are NOT exported (internal to hexagon)
```

### Contract Tests

- save + findById roundtrip
- save + findByLabel roundtrip
- findBySliceId returns matching tasks
- findBySliceId returns empty array when none match
- findById returns null for unknown id
- findByLabel returns null for unknown label
- label uniqueness: save rejects duplicate label within same slice
- label uniqueness: allows same label in different slices
- save allows updating an existing task

### Kernel Changes

Add to `EVENT_NAMES` in `src/kernel/events/event-names.ts`:
```typescript
TASK_CREATED: "task.created",
TASK_COMPLETED: "task.completed",
TASK_BLOCKED: "task.blocked",
```

## Acceptance Criteria

- [ ] AC1: `Task.createNew()` creates a valid task with status `open` and emits `TaskCreatedEvent`
- [ ] AC2: `TaskStatusVO` enforces all 5 valid transitions
- [ ] AC3: `TaskStatusVO` rejects invalid transitions with `InvalidTransitionError`
- [ ] AC4: `start()` transitions open -> in_progress
- [ ] AC5: `complete()` transitions in_progress -> closed, emits `TaskCompletedEvent`
- [ ] AC6: `block()` transitions open -> blocked, sets blockedBy, emits `TaskBlockedEvent`
- [ ] AC7: `block()` on already-blocked task adds to blockedBy (self-transition), no duplicate event
- [ ] AC8: `unblock()` removes blocker; if blockedBy empty, transitions blocked -> open
- [ ] AC9: `unblock()` with remaining blockers stays blocked (self-transition)
- [ ] AC10: `assignToWave()` sets waveIndex and updates updatedAt
- [ ] AC11: `reconstitute()` hydrates from props without emitting events
- [ ] AC12: Label validation enforces `T{nn}` format via Zod regex
- [ ] AC13: Label uniqueness scoped to slice in repository
- [ ] AC14: InMemoryTaskRepository passes all contract tests
- [ ] AC15: InMemoryTaskRepository has `seed()` and `reset()` helpers
- [ ] AC16: SqliteTaskRepository stub exists with correct interface
- [ ] AC17: TaskBuilder produces valid Tasks with Faker defaults and supports chaining
- [ ] AC18: `CyclicDependencyError` has code `TASK.CYCLIC_DEPENDENCY` and includes cycle path
- [ ] AC19: `TaskNotFoundError` has code `TASK.NOT_FOUND`
- [ ] AC20: Barrel exports only ports, events, schemas, DTOs, and errors (not aggregate or VO)
- [ ] AC21: Kernel `EVENT_NAMES` updated with task events
- [ ] AC22: All tests pass
- [ ] AC23: `biome check` passes on all new files

## Non-Goals

- Working SQLite adapter (stubbed only)
- Wave detection algorithm (that's S02)
- Cross-hexagon wiring (Task <-> Slice referential integrity)
- Task re-opening after completion
- Event publishing to EventBus

## Dependencies

- kernel/ base classes (AggregateRoot, ValueObject, DomainEvent, Result, schemas, errors, EVENT_NAMES)
- S06/S07 patterns (hexagon structure, contract tests, barrel exports)
- `InvalidTransitionError` from kernel

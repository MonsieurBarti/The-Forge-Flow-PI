# M04-S01: Checkpoint Entity + Repository

## Problem

The execution engine (M04) needs crash recovery. When an agent crashes mid-execution, the system must know which tasks completed, which wave was active, and where to resume. Without checkpoints, a crash means re-executing all tasks from scratch — wasting tokens and time.

## Approach

**CHECKPOINT.md as primary storage.** One checkpoint per slice, persisted as a markdown file with human-readable header + machine-parseable JSON in an HTML comment. No SQLite for checkpoints — the file IS the persistence layer.

**Full DDD aggregate.** Checkpoint follows the established pattern: `AggregateRoot<CheckpointProps>`, factory methods, business methods returning `Result<T, E>`, domain events. Standalone — no cross-hexagon dependencies.

**Rationale:**
- File-based storage survives SQLite corruption (the very scenario checkpoints protect against)
- Follows existing artifact patterns (SPEC.md, PLAN.md)
- Single source of truth — zero sync issues
- Written infrequently (per-task/per-wave), read rarely (only on resume)

## Design

### Schemas

```typescript
// hexagons/execution/domain/checkpoint.schemas.ts

const ExecutorLogEntrySchema = z.object({
  taskId: IdSchema,
  agentIdentity: z.string().min(1),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable().default(null),
});
type ExecutorLogEntry = z.infer<typeof ExecutorLogEntrySchema>;

const CheckpointPropsSchema = z.object({
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
type CheckpointProps = z.infer<typeof CheckpointPropsSchema>;
```

**Design spec deviations (intentional):**
- `completedAt` uses `.nullable().default(null)` instead of `.optional()` — roundtrips cleanly through `JSON.parse`/`JSON.stringify` (JSON has `null` but not `undefined`)
- `baseCommit` adds `.min(1)` — empty string is never a valid commit ref
- `agentIdentity` adds `.min(1)` — empty identity is meaningless

### Aggregate

```typescript
// hexagons/execution/domain/checkpoint.aggregate.ts

class Checkpoint extends AggregateRoot<CheckpointProps> {
  private constructor(props: CheckpointProps) {
    super(props, CheckpointPropsSchema);
  }

  // ── Factories ──
  static createNew(params: {
    id: string; sliceId: string; baseCommit: string; now: Date;
  }): Checkpoint;
  // No CheckpointCreatedEvent — checkpoints are internal execution state,
  // not user-facing entities. Creation is observed via journal (M04-S02).

  static reconstitute(props: CheckpointProps): Checkpoint;

  // ── Getters ──
  get id(): string;
  get sliceId(): string;
  get baseCommit(): string;
  get currentWaveIndex(): number;
  get completedWaves(): readonly number[];
  get completedTasks(): readonly string[];
  get executorLog(): readonly ExecutorLogEntry[];

  // ── Business Methods ──
  // All business methods update this.props.updatedAt = now.

  recordTaskStart(taskId: string, agentIdentity: string, now: Date): Result<void, InvalidCheckpointStateError>;
  // Idempotent: calling twice for same taskId is a no-op (crash recovery safe).
  // If called with a different agentIdentity for the same taskId, the new identity
  // overwrites the old one (crash recovery may re-assign to a different agent).
  // Mutates: adds entry to executorLog (or updates agentIdentity if exists)
  // NOTE: Callers MUST persist via repo.save() after this call to survive crashes.
  // No domain event is emitted — persistence is the caller's responsibility.

  recordTaskComplete(taskId: string, now: Date): Result<void, InvalidCheckpointStateError>;
  // Guards: task must have a started entry, not already completed
  // Mutates: sets completedAt on log entry, adds to completedTasks
  // Emits: CheckpointSavedEvent

  advanceWave(now: Date): Result<void, InvalidCheckpointStateError>;
  // Caller validates all tasks in current wave are done (separation of concerns).
  // Guards: currentWaveIndex not already in completedWaves (no duplicate advance).
  // Mutates: adds currentWaveIndex to completedWaves, increments currentWaveIndex
  // Emits: CheckpointSavedEvent

  // ── Queries ──
  isTaskCompleted(taskId: string): boolean;
  isWaveCompleted(waveIndex: number): boolean;
  isTaskStarted(taskId: string): boolean;
}
```

### Domain Events

```typescript
// events/checkpoint-saved.event.ts

const CheckpointSavedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  waveIndex: z.number().int().min(0),
});
type CheckpointSavedEventProps = z.infer<typeof CheckpointSavedEventPropsSchema>;

class CheckpointSavedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.CHECKPOINT_SAVED; // 'execution.checkpoint-saved'
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

`CHECKPOINT_SAVED` added to kernel `EVENT_NAMES` and `EventNameSchema`.

### Domain Errors

```typescript
// errors/checkpoint-not-found.error.ts — code: 'CHECKPOINT.NOT_FOUND'
class CheckpointNotFoundError extends BaseDomainError {}

// errors/invalid-checkpoint-state.error.ts — code: 'CHECKPOINT.INVALID_STATE'
class InvalidCheckpointStateError extends BaseDomainError {}
```

No abstract `CheckpointBaseError` — consistent with slice/task hexagons which extend `BaseDomainError` directly. Both errors use descriptive messages for the specific violation.

### Repository Port

```typescript
// ports/checkpoint-repository.port.ts
abstract class CheckpointRepositoryPort {
  abstract save(checkpoint: Checkpoint): Promise<Result<void, PersistenceError>>;
  abstract findBySliceId(sliceId: string): Promise<Result<Checkpoint | null, PersistenceError>>;
  abstract delete(sliceId: string): Promise<Result<void, PersistenceError>>;
}
```

Keyed by `sliceId` (one checkpoint per slice). No `findById` — the use case always looks up by slice.

### Adapters

**InMemoryCheckpointRepository** — `Map<string, CheckpointProps>` keyed by sliceId. `seed()`/`reset()` for test setup.

**MarkdownCheckpointRepository** — Reads/writes CHECKPOINT.md files.

**Path resolution:** The adapter constructor takes `basePath: string` (the `.tff` directory) and `resolveSlicePath: (sliceId: string) => Promise<Result<string, PersistenceError>>`. The resolver returns the relative path from basePath to the slice directory (e.g. `milestones/M04/slices/M04-S01`). Full path: `${basePath}/${resolvedPath}/CHECKPOINT.md`.

```typescript
class MarkdownCheckpointRepository extends CheckpointRepositoryPort {
  constructor(
    private readonly basePath: string,
    private readonly resolveSlicePath: (sliceId: string) => Promise<Result<string, PersistenceError>>,
  ) {}
}
```

This keeps the adapter standalone — no cross-hexagon import. The composition root wires the resolver (which may query the slice repo). For tests, the resolver is a simple lookup map. If the resolver returns an error (e.g. slice not found), the adapter propagates it as `PersistenceError`.

**Error handling:** `findBySliceId` returns `PersistenceError` for corrupt CHECKPOINT.md (malformed JSON, missing HTML comment). The adapter does NOT throw — it wraps parse failures in `PersistenceError` with diagnostic context.

CHECKPOINT.md format:

```markdown
# Checkpoint — M04-S01

- **Slice:** M04-S01
- **Base Commit:** abc123f
- **Current Wave:** 2
- **Completed Waves:** 0, 1
- **Completed Tasks:** 3

## Executor Log

| Task | Agent | Started | Completed |
|------|-------|---------|-----------|
| T01  | opus  | 14:01   | 14:03     |
| T02  | sonnet| 14:01   | 14:04     |
| T03  | opus  | 14:05   | —         |

<!-- CHECKPOINT_JSON
{"id":"...","sliceId":"...","baseCommit":"abc123f",...}
-->
```

- Human-readable header for quick inspection (derived from JSON, not the source of truth)
- JSON in HTML comment for machine parsing
- Write strategy: write to `.tmp` file, rename (atomic on POSIX)

### Contract Tests

Shared test suite (`checkpoint-repository.contract.spec.ts`) validates both adapters:
- Save + findBySliceId roundtrip (props equality)
- Save with non-empty executorLog — roundtrip preserves all entries
- findBySliceId returns null for missing slice
- Save overwrites existing checkpoint for same slice
- Delete removes checkpoint
- Delete is no-op for missing checkpoint
- findBySliceId returns PersistenceError for corrupt file (Markdown adapter only)

## File Structure

```
hexagons/execution/
  domain/
    checkpoint.schemas.ts
    checkpoint.schemas.spec.ts
    checkpoint.aggregate.ts
    checkpoint.aggregate.spec.ts
    checkpoint.builder.ts
    errors/
      checkpoint-not-found.error.ts
      invalid-checkpoint-state.error.ts
    events/
      checkpoint-saved.event.ts
    ports/
      checkpoint-repository.port.ts
  infrastructure/
    in-memory-checkpoint.repository.ts
    in-memory-checkpoint.repository.spec.ts
    markdown-checkpoint.repository.ts
    markdown-checkpoint.repository.spec.ts
    checkpoint-repository.contract.spec.ts
```

## Non-Goals

- SQLite adapter for checkpoints (file-based is primary and sufficient)
- Cost tracking in executor log (deferred to M04-S06)
- Journal integration (deferred to M04-S02)
- Task failure tracking in checkpoint (deferred — journal tracks failures, use case derives retry state)
- Cross-hexagon validation of sliceId or baseCommit
- ExecuteSliceUseCase (separate slice — M04-S06)
- `CheckpointCreatedEvent` (internal state — observable via journal)
- `isExecutionComplete()` query (checkpoint has no totalWaves/totalTasks — orchestrator checks this)

## Design Notes

- **R01 deviation:** R01 says "SQLite + in-memory adapters." This spec uses Markdown + in-memory instead. Rationale: file-based storage survives SQLite corruption, which is the exact failure mode checkpoints protect against.
- **`completedWaves` ordering:** The array is append-only. Callers MUST NOT skip waves. Sequential ordering is enforced by the orchestrator (ExecuteSliceUseCase), not the checkpoint aggregate.
- **Failure tracking:** Deferred to M04-S02 (Journal). The checkpoint tracks recovery state (what completed, where to resume). The journal is the failure audit trail. The use case (M04-S06) derives "what to retry" by comparing checkpoint.completedTasks against the full task list.

## Acceptance Criteria

1. `Checkpoint.createNew()` produces valid aggregate with wave 0, empty completedTasks/completedWaves
2. `recordTaskStart()` is idempotent — calling twice for same taskId is a no-op; different agentIdentity overwrites
3. `recordTaskComplete()` fails with `InvalidCheckpointStateError` if task not started
4. `advanceWave()` increments currentWaveIndex and appends previous to completedWaves; guards against duplicate advance
5. `isTaskCompleted()` / `isWaveCompleted()` / `isTaskStarted()` return correct state
6. `save()` after `recordTaskComplete()` produces a CHECKPOINT.md with the task in completedTasks
7. `save()` after `advanceWave()` produces a CHECKPOINT.md with the wave in completedWaves
8. CHECKPOINT.md roundtrip — `MarkdownCheckpointRepository` writes and reads back identical CheckpointProps (including non-empty executorLog)
9. CHECKPOINT.md JSON recoverable from HTML comment via single `JSON.parse`
10. Contract tests pass for both InMemory and Markdown adapters
11. `CheckpointSavedEvent` emitted on `recordTaskComplete()` and `advanceWave()`
12. Builder produces valid Checkpoint instances with sensible faker defaults
13. `CHECKPOINT_SAVED` added to kernel `EVENT_NAMES` and `EventNameSchema`; existing `event-names.spec.ts` updated
14. All business methods update `updatedAt` timestamp

# M04-S02: Journal Entity + Replay

**Requirement:** R05 — Crash Recovery
**Blocks:** S07 (Wave-based execution engine), S10 (Execute/pause/resume commands)
**Hexagon:** `execution` (alongside Checkpoint)

## Problem

During execution, agent crashes, network failures, or user interruptions can leave the system in an inconsistent state. Without an event log, there is no way to know what happened, resume from where things left off, or undo execution commits. The Checkpoint tracks *state* (which tasks/waves completed) but not *history* (what happened and when).

## Approach

An append-only per-slice JSONL journal records every significant execution event. The journal is the audit trail; `Checkpoint` remains the state snapshot. On resume, journal replay validates consistency with checkpoint state. On rollback, the journal identifies which commits to revert.

**Key decisions:**
- **Per-slice storage:** `.tff/milestones/<M>/slices/<id>/journal.jsonl`
- **Event-driven:** subscribes to `EventBusPort`, callers never write directly (except 3 entry types appended by downstream use cases)
- **Fail-fast:** unprocessable entries during replay surface as `JournalReplayError` (no dead-letter queue)
- **Immutable entries:** journal entries are facts, not commands — once written, never modified
- **Best-effort audit:** journal write failures in event handlers are logged but do not halt execution (EventBusPort swallows handler errors by design). The journal is an audit trail, not a transactional guarantee.

## Prerequisites & Upstream Changes

This slice requires extending existing infrastructure:

### GitPort Extensions (kernel)

`GitPort` gains two new methods required by `RollbackSliceUseCase`:

```typescript
abstract revert(commitHash: string): Promise<Result<void, GitError>>;
abstract isAncestor(ancestor: string, descendant: string): Promise<Result<boolean, GitError>>;
```

Both methods must be implemented in `GitCliAdapter` (production) and any test adapters.

### Domain Event Extensions

Existing events lack fields required by journal entries. This slice extends them:

| Event | New Fields | Reason |
|---|---|---|
| `CheckpointSavedEvent` | `completedTaskCount: number` | `checkpoint-saved` entry needs it. Emitters pass `this.props.completedTasks.length` at emission time. |
| `TaskCompletedEvent` | `sliceId: string`, `taskId: string`, `waveIndex: number`, `durationMs: number`, `commitHash?: string` | `task-completed` entry needs them. `sliceId` required because `aggregateId` is the task ID, not the slice ID. |
| `TaskBlockedEvent` | `sliceId: string`, `taskId: string`, `waveIndex: number`, `errorCode: string`, `errorMessage: string` | `task-failed` entry needs them. `sliceId` required for same reason as above. |
| `SliceStatusChangedEvent` | `from: string`, `to: string` | `phase-changed` entry needs them. |

Event extensions are backward-compatible. Existing event emitters must be updated to supply the new fields.

**Note on `completedTaskCount`:** Both `recordTaskComplete()` and `advanceWave()` emit `CheckpointSavedEvent`. Both pass `this.props.completedTasks.length` as `completedTaskCount` — this is the count at emission time, reflecting the current checkpoint state.

## Domain Model

### Schemas

`JournalEntry` is a plain Zod-inferred type — not an Entity, AggregateRoot, or ValueObject. Entries are immutable facts with no identity lifecycle or business methods.

`seq` is a logical sequence number used for ordering and incremental replay. The JSONL adapter derives it from line count, but this is an implementation detail — `seq` is the logical ordering key, not a physical line index.

```typescript
// journal-entry.schemas.ts

const JournalEntryBaseSchema = z.object({
  seq: z.number().int().min(0),
  sliceId: IdSchema,
  timestamp: TimestampSchema,
  correlationId: IdSchema.optional(),
});

// 7 entry types (discriminated union on 'type')

const TaskStartedEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal('task-started'),
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  agentIdentity: z.string().min(1),
});

const TaskCompletedEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal('task-completed'),
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  commitHash: z.string().optional(),
});

const TaskFailedEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal('task-failed'),
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  errorCode: z.string(),
  errorMessage: z.string(),
  retryable: z.boolean(),
});

const FileWrittenEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal('file-written'),
  taskId: IdSchema,
  filePath: z.string().min(1),
  operation: z.enum(['created', 'modified', 'deleted']),
});

const CheckpointSavedEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal('checkpoint-saved'),
  waveIndex: z.number().int().min(0),
  completedTaskCount: z.number().int().min(0),
});

const PhaseChangedEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal('phase-changed'),
  from: z.string(),
  to: z.string(),
});

const ArtifactWrittenEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal('artifact-written'),
  artifactPath: z.string().min(1),
  artifactType: z.enum(['spec', 'plan', 'research', 'checkpoint']),
});

const JournalEntrySchema = z.discriminatedUnion('type', [
  TaskStartedEntrySchema,
  TaskCompletedEntrySchema,
  TaskFailedEntrySchema,
  FileWrittenEntrySchema,
  CheckpointSavedEntrySchema,
  PhaseChangedEntrySchema,
  ArtifactWrittenEntrySchema,
]);
type JournalEntry = z.infer<typeof JournalEntrySchema>;
```

**Rationale:**
- `seq` — monotonic sequence number for ordering and incremental replay
- `commitHash` on `task-completed` — supports rollback (identify execution commits)
- `correlationId` — links related entries (e.g., start/complete for same task)
- No aggregate — entries are immutable facts; repository handles append semantics

### Ports

```typescript
// ports/journal-repository.port.ts
abstract class JournalRepositoryPort {
  abstract append(sliceId: string, entry: Omit<JournalEntry, 'seq'>): Promise<Result<number, JournalWriteError>>;
  abstract readAll(sliceId: string): Promise<Result<readonly JournalEntry[], JournalReadError>>;
  abstract readSince(sliceId: string, afterSeq: number): Promise<Result<readonly JournalEntry[], JournalReadError>>;
  abstract count(sliceId: string): Promise<Result<number, JournalReadError>>;
}
```

- `append()` takes `Omit<JournalEntry, 'seq'>` — repository assigns seq (monotonic from line count)
- `readSince()` supports incremental replay without loading full journal
- `readSince` is implemented as `readAll -> filter` (O(n)). Acceptable for expected journal sizes (hundreds of entries per slice). Seek-based optimization deferred as future concern.

### Errors

| Error | Code | Use |
|-------|------|-----|
| `JournalWriteError` | `JOURNAL.WRITE_FAILURE` | append fails (disk, permission) |
| `JournalReadError` | `JOURNAL.READ_FAILURE` | read/parse fails (corrupt line) |
| `JournalReplayError` | `JOURNAL.REPLAY_FAILURE` | inconsistency during replay |
| `RollbackError` | `JOURNAL.ROLLBACK_FAILURE` | git revert fails |

## Use Cases

### ReplayJournalUseCase

```
Input:  { sliceId, checkpoint }
Output: Result<ReplayResult, JournalReplayError>

ReplayResult = {
  resumeFromWave: number,
  completedTaskIds: string[],
  lastProcessedSeq: number,
  consistent: boolean,
}

1. Read journal entries for slice
2. If journal is empty and checkpoint has completedTasks -> JournalReplayError
   (pre-journal checkpoints are not supported — journal and checkpoint
    are always created together in the same execution lifecycle)
3. Walk entries in seq order:
   - task-started/completed -> build set of completed tasks
   - checkpoint-saved -> validate wave progression matches checkpoint
4. Cross-validate against checkpoint state:
   - forall taskId in checkpoint.completedTasks: exists task-completed entry in journal
   - journal.lastWave <= checkpoint.currentWaveIndex
5. Inconsistency -> JournalReplayError (entry seq + reason)
6. Return resume point: { resumeFromWave, completedTaskIds }
```

Replay is read-only — validates and returns resume point, does not mutate state.

### RollbackSliceUseCase

```
Input:  { sliceId, checkpoint, sliceTransitionPort }
Output: Result<RollbackResult, RollbackError>

RollbackResult = {
  revertedCommits: string[],
  failedReverts: string[],
  journalEntriesProcessed: number,
}

1. Read journal entries for slice
2. Collect commitHash from task-completed entries (filter non-null)
   (journal entries distinguish execution commits from artifact commits
    by entry type — no commit message parsing needed)
3. Filter: only commits AFTER checkpoint.baseCommit via GitPort.isAncestor()
4. Revert in reverse chronological order via GitPort.revert()
5. On partial failure (revert N of M):
   - Record successfully reverted commits in result
   - Record failed commit hash in failedReverts
   - Return RollbackError with partial result attached
   - Do NOT silently continue — the caller decides how to proceed
6. On full success: delegate phase transition to sliceTransitionPort
   (which triggers SliceStatusChangedEvent -> event handler appends
    phase-changed journal entry)
7. Return list of reverted commits
```

Rollback uses `GitPort.revert()` (not reset — preserves history). Phase change delegated to `SliceTransitionPort` to maintain aggregate-owns-events pattern. Partial failure is explicitly surfaced, never swallowed.

## Infrastructure

### JsonlJournalRepository

```
Storage: .tff/milestones/<M>/slices/<id>/journal.jsonl
Format: One JSON object per line, newline-delimited

append: resolve path -> read line count -> assign seq -> JSON.stringify -> fs.appendFile
readAll: read lines -> parse each via JournalEntrySchema -> fail on corrupt line with line number
readSince: readAll -> filter seq > afterSeq
```

- `fs.appendFile` with `'a'` flag — atomic for single-writer (orchestrator)
- Partial/truncated lines detectable on next read -> `JournalReadError`

### InMemoryJournalRepository

`Map<sliceId, JournalEntry[]>` — mirrors JSONL behavior. Colocated in `infrastructure/`.

### Contract Spec

Shared test suite against both adapters:
- append assigns monotonic seq
- readAll returns entries in seq order
- readSince filters correctly
- count matches entry count
- append to non-existent slice creates entry list

## Event Subscriptions

`JournalEventHandler` subscribes to domain events via `EventBusPort`. All required fields are extracted from the event payload (no repository lookups in handlers).

**Important:** `EventBusPort` catches and logs handler errors without rethrowing. This means journal write failures are silently tolerated — the journal is a best-effort audit trail, not a transactional guarantee. This is acceptable because: (1) the Checkpoint is the authoritative state, (2) journal entries are supplementary traceability, (3) a journal write failure should not halt execution.

| Domain Event | Journal Entry Type | Fields from Event |
|---|---|---|
| `CheckpointSavedEvent` | `checkpoint-saved` | sliceId, waveIndex, completedTaskCount |
| `TaskCompletedEvent` | `task-completed` | sliceId, taskId, waveIndex, durationMs, commitHash |
| `TaskBlockedEvent` | `task-failed` (retryable: true) | sliceId, taskId, waveIndex, errorCode, errorMessage |
| `SliceStatusChangedEvent` | `phase-changed` | sliceId (from aggregateId), from, to |

**Explicitly appended by downstream use cases (S07/S10):**
- `task-started` — by `ExecuteSliceUseCase` before agent dispatch (needs `agentIdentity`)
- `file-written` — by agent result handler (from `AgentResult.filesChanged`)
- `artifact-written` — by workflow commands

Event handler registered at app bootstrap. Sequential processing per architectural rules.

## Acceptance Criteria

| # | Criterion | Test Strategy |
|---|-----------|---------------|
| AC1 | Journal entries persisted to per-slice JSONL survive process restart | JSONL adapter: write, re-instantiate, read back |
| AC2 | Entries ordered by monotonic seq (no gaps, no duplicates) | Contract: append N -> verify seq 0..N-1 |
| AC3 | JournalEntrySchema rejects malformed entries at parse time | Schema spec: invalid type, missing fields |
| AC4 | Replay validates journal <-> checkpoint consistency — returns resume point | Use case: matching data -> ok |
| AC5 | Replay detects inconsistency and fails fast with JournalReplayError | Use case: checkpoint says done, journal missing -> error |
| AC6 | Rollback reverts execution commits in reverse order via GitPort.revert() | Use case: mock GitPort -> verify revert order |
| AC7 | Rollback excludes artifact-written entries (only reverts task-completed commitHashes) | Use case: journal with mixed entries -> only task-completed commits reverted |
| AC8 | Event handler auto-appends on CheckpointSavedEvent / TaskCompletedEvent | Integration: emit event -> verify entry with correct sliceId |
| AC9 | readSince returns only entries after specified seq | Contract: write 10, readSince(5) -> 4 entries |
| AC10 | Partial/corrupted JSONL line -> JournalReadError with line number | JSONL adapter: truncated line -> error |
| AC11 | GitPort.revert() and GitPort.isAncestor() implemented in GitCliAdapter | Integration: revert a commit, check ancestry |
| AC12 | Partial rollback failure returns RollbackError with revertedCommits and failedReverts | Use case: GitPort.revert() fails on 3rd of 5 -> error includes 2 reverted + 1 failed |

## Non-Goals

- Multi-writer concurrency (orchestrator is single-writer)
- Journal compaction or archival
- Dead-letter queue (fail-fast instead)
- Journal entry editing or deletion (append-only invariant)
- Real-time journal streaming/tailing
- Backward compatibility with pre-journal checkpoints (journal and checkpoint are always created together)
- Transactional journal write guarantees (best-effort audit via event handlers)

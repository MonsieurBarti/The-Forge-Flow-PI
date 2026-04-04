# M07-S02: SQLite Repos + State Branch CRUD + JSON Export/Import

## Problem

Two compounding gaps block durable state persistence:

1. **No local persistence.** Core domain entities (project, milestone, slice, task) live only in InMemory repositories (`extension.ts`: _"in-memory for now; SQLite swap in later slice"_). State is lost between CLI invocations. The SQLite repos for these entities are stubs that throw "Not implemented".

2. **No state branch sync.** S01 built `StateBranchOpsPort` (low-level git primitives for orphan branches) and `mergeSnapshots()` (entity-ID merge), but nothing writes domain state to state branches or reads it back. The existing `StateSyncPort` (`push/pull/markDirty`) is too narrow for branch-aware persistence.

Without both layers: no local durability, no team collaboration, no recovery from lost `.tff/`. Solving only state-branch sync without local SQLite would require a git read on every CLI invocation to rehydrate in-memory repos — unacceptable latency for daily use.

## Approach

### 0. SQLite Repositories for Core Entities

Implement the four stubbed SQLite repos, following the established pattern from `SqliteShipRecordRepository`:

**Shared `state.db`** — single database file at `.tff/state.db` for all core entities (unlike ship/completion records which use separate `.db` files). Created/opened once in `extension.ts`, injected into all four repos.

**SqliteProjectRepository** (`project/infrastructure/`):

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | |
| vision | TEXT NOT NULL | |
| created_at | TEXT NOT NULL | ISO8601 |
| updated_at | TEXT NOT NULL | ISO8601 |

Methods: `save()` (INSERT OR REPLACE), `findById()`, `findSingleton()`, `reset()`.
Singleton constraint: enforce in `save()` — reject if a different ID already exists (matches InMemory behavior).

**SqliteMilestoneRepository** (`milestone/infrastructure/`):

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| project_id | TEXT NOT NULL | FK to projects |
| label | TEXT NOT NULL UNIQUE | e.g. "M07" |
| title | TEXT NOT NULL | |
| description | TEXT NOT NULL | default "" |
| status | TEXT NOT NULL | open/in_progress/closed |
| created_at | TEXT NOT NULL | ISO8601 |
| updated_at | TEXT NOT NULL | ISO8601 |

Methods: `save()`, `findById()`, `findByLabel()`, `findByProjectId()`, `reset()`.
Label uniqueness: enforced by UNIQUE constraint.

**SqliteSliceRepository** (`slice/infrastructure/`):

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| milestone_id | TEXT NOT NULL | FK to milestones |
| label | TEXT NOT NULL UNIQUE | e.g. "M07-S02" |
| title | TEXT NOT NULL | |
| description | TEXT NOT NULL | default "" |
| status | TEXT NOT NULL | discussing/researching/... |
| complexity | TEXT | nullable (S/F-lite/F-full) |
| spec_path | TEXT | nullable |
| plan_path | TEXT | nullable |
| research_path | TEXT | nullable |
| created_at | TEXT NOT NULL | ISO8601 |
| updated_at | TEXT NOT NULL | ISO8601 |

Methods: `save()`, `findById()`, `findByLabel()`, `findByMilestoneId()`, `reset()`.

**SqliteTaskRepository** (`task/infrastructure/`):

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| slice_id | TEXT NOT NULL | FK to slices |
| label | TEXT NOT NULL | e.g. "T01" |
| title | TEXT NOT NULL | |
| description | TEXT NOT NULL | default "" |
| acceptance_criteria | TEXT NOT NULL | default "" |
| file_paths | TEXT NOT NULL | JSON array |
| status | TEXT NOT NULL | open/in_progress/closed/blocked |
| blocked_by | TEXT NOT NULL | JSON array of UUIDs |
| wave_index | INTEGER | nullable |
| created_at | TEXT NOT NULL | ISO8601 |
| updated_at | TEXT NOT NULL | ISO8601 |

Methods: `save()`, `findById()`, `findByLabel()`, `findBySliceId()`, `reset()`.
Label uniqueness: scoped to slice (UNIQUE on `(slice_id, label)`).
Array columns (`file_paths`, `blocked_by`): stored as JSON TEXT, parsed on read.

**Extension wiring swap**: Replace `InMemory*Repository` with `Sqlite*Repository` in `extension.ts`, backed by a shared `state.db` opened via `better-sqlite3`.

**Contract spec integration**: Each contract spec already defines the test suite. Add a second `runContractTests()` call for the SQLite impl (same pattern as InMemory already uses).

**`findAll()` additions**: Add `findAll()` to `ShipRecordRepositoryPort` and `CompletionRecordRepositoryPort` — needed by StateExporter to collect all records for snapshot. Implement in both SQLite and InMemory variants. Tested via existing contract spec pattern (add `findAll()` test to each contract suite).

**`reset()` on existing SQLite repos**: The existing `SqliteShipRecordRepository` and `SqliteCompletionRecordRepository` lack `reset()`. Add `reset()` (`DELETE FROM <table>`) to both so they can participate in contract specs alongside their InMemory variants.

### 1. StateSnapshotSchema (Zod)

Define the canonical JSON shape exported to state branches:

```typescript
export const StateSnapshotSchema = z.object({
  version: z.literal(1),
  exportedAt: TimestampSchema,
  project: ProjectPropsSchema.nullable(),
  milestones: z.array(MilestonePropsSchema),
  slices: z.array(SlicePropsSchema),
  tasks: z.array(TaskPropsSchema),
  shipRecords: z.array(ShipRecordPropsSchema).default([]),
  completionRecords: z.array(CompletionRecordPropsSchema).default([]),
});
```

**Date serialization**: All `TimestampSchema` fields are stored as ISO8601 strings in JSON. The existing `TimestampSchema` uses `z.coerce.date()`, so import from raw JSON strings works automatically. Export calls `aggregate.toJSON()` which returns `Date` objects — the `StateExporter` must serialize via `JSON.stringify` with a Date-to-ISO replacer, or pre-convert via `date.toISOString()` before building the snapshot.

**`workflowSession` excluded**: The design spec mentions `workflowSession` in the snapshot, but workflow sessions are ephemeral (reconstructed per CLI invocation, not persisted). Deliberately excluded.

Schema versioning:
- `SCHEMA_VERSION = 1` constant
- `MIGRATIONS: Record<number, (old: unknown) => unknown>` map for breaking changes
- Zod `.default()` on additive fields so old snapshots hydrate without migration
- Abort if snapshot version > code version (forward-incompatible)

### 2. BranchMetaSchema (Zod)

```typescript
export const BranchMetaSchema = z.object({
  version: z.literal(1),
  stateId: IdSchema,                    // stable UUID for rename detection
  codeBranch: z.string().min(1),        // e.g. "milestone/M07"
  stateBranch: z.string().min(1),       // e.g. "tff-state/milestone/M07"
  parentStateBranch: z.string().nullable(), // null for tff-state/main
  lastSyncedAt: TimestampSchema.nullable(),
  lastJournalOffset: z.number().int().nonnegative().default(0),
  dirty: z.boolean().default(false),
});
```

Replaces current ad-hoc `branch-meta.json`. Backward-compatible via Zod defaults for new fields.

### 3. Redesigned StateSyncPort

Replace the existing 3-method port with a branch-aware interface:

```typescript
export abstract class StateSyncPort {
  abstract syncToStateBranch(codeBranch: string, tffDir: string): Promise<Result<void, SyncError>>;
  abstract restoreFromStateBranch(codeBranch: string, tffDir: string): Promise<Result<SyncReport, SyncError>>;
  abstract mergeStateBranches(child: string, parent: string, sliceId: string): Promise<Result<void, SyncError>>;
  abstract createStateBranch(codeBranch: string, parentStateBranch: string): Promise<Result<void, SyncError>>;
  abstract deleteStateBranch(codeBranch: string): Promise<Result<void, SyncError>>;
}
```

`SyncError` extended with discriminated variants: `BRANCH_NOT_FOUND` (state branch doesn't exist — distinct from sync failure), `LOCK_CONTENTION` (non-blocking skip), `SCHEMA_VERSION_MISMATCH` (snapshot newer than code), `EXPORT_FAILED`, `IMPORT_FAILED`.

### 4. StateExporter — Domain Service (kernel)

Location: `src/kernel/services/state-exporter.ts` — lives in kernel because it spans all hexagons' repository ports.

Collects state from all repository ports → produces `StateSnapshot`:

- `projectRepo.findSingleton()` → project
- `milestoneRepo.findByProjectId(projectId)` → milestones
- For each milestone: `sliceRepo.findByMilestoneId()` → slices
- For each slice: `taskRepo.findBySliceId()` → tasks
- `shipRecordRepo.findAll()` → ship records (**new method on port**)
- `completionRecordRepo.findAll()` → completion records (**new method on port**)

Returns a validated `StateSnapshot` object.

### 5. StateImporter — Domain Service (kernel)

Location: `src/kernel/services/state-importer.ts` — same rationale as StateExporter.

Takes a `StateSnapshot` → populates all repository ports:

- Parse and validate via `StateSnapshotSchema` (with migration if needed)
- Reconstitute aggregates: `Project.reconstitute(props)`, `Milestone.reconstitute(props)`, etc.
- Save to repos: `repo.save(aggregate)` for each entity
- Ship/completion records: save via their respective repos

Import is additive (save/upsert) — the caller is responsible for clearing stale state before import if needed.

### 6. GitStateSyncAdapter

Implementation of `StateSyncPort` using `StateBranchOpsPort` from S01:

**syncToStateBranch(codeBranch, tffDir):**
1. Acquire lock (`.tff/.lock`)
2. Export state via `StateExporter` → `StateSnapshot`
3. Collect files: `state-snapshot.json`, `branch-meta.json`, `settings.yaml`, milestone artifacts (REQUIREMENTS.md, SPEC.md, PLAN.md, CHECKPOINT.md, etc.)
4. Normalize journal: read from `tffDir/milestones/M##/{sliceId}.jsonl` → map as `journal.jsonl`
5. Include `metrics.jsonl` from tffDir
6. Call `stateBranchOps.syncToStateBranch(stateBranch, files)`
7. Update `branch-meta.json` locally (lastSyncedAt, dirty=false)
8. Release lock

**restoreFromStateBranch(codeBranch, tffDir):**
1. Acquire lock
2. Resolve state branch name: `tff-state/<codeBranch>`
3. Call `stateBranchOps.readAllFromStateBranch(stateBranch)` → file map
4. Parse `state-snapshot.json` → validate/migrate → `StateSnapshot`
5. Import via `StateImporter` → populate repos
6. Write artifacts to local `.tff/` paths
7. Denormalize journal: `journal.jsonl` → `tffDir/milestones/M##/{sliceId}.jsonl`
8. Write `metrics.jsonl` to tffDir
9. Write updated `branch-meta.json`
10. Release lock

**mergeStateBranches(child, parent, sliceId):**
1. Read both state-snapshot.json from child and parent branches
2. Call `mergeSnapshots(parentSnapshot, childSnapshot, sliceId)` (from S01)
3. Merge ship/completion records (union by ID, child wins on conflict)
4. Merge metrics (append child entries to parent)
5. Merge artifacts (copy child's slice artifacts into parent tree)
6. Write merged result to parent state branch

**createStateBranch(codeBranch, parentStateBranch):**
1. Fork: `stateBranchOps.forkBranch(parentStateBranch, tff-state/<codeBranch>)`
2. Write initial `branch-meta.json` with new stateId

**deleteStateBranch(codeBranch):**
1. `stateBranchOps.deleteBranch(tff-state/<codeBranch>)`

### 7. Advisory Lockfile

Simple file-based lock at `.tff/.lock`:

```typescript
export class AdvisoryLock {
  acquire(lockPath: string, timeoutMs?: number): Result<LockHandle, LockError>;
  release(handle: LockHandle): void;
}
```

- Lock file contains: `{ pid: number, acquiredAt: string }`
- Stale detection: if PID is not running → break lock
- Timeout: default 5s, non-blocking skip on contention
- Release in `finally` blocks (crash-safe)

### 8. Journal Path Normalization

Local layout: `.tff/milestones/M##/{sliceId}.jsonl` (one file per slice)
State branch layout: `journal.jsonl` (single flat file at root)

- **Export:** Read local journal file → write as `journal.jsonl` on state branch
- **Import:** Read `journal.jsonl` from state branch → write to local nested path
- **Merge:** Append child's journal entries to parent (deduplicate by seq number)

### 9. Metrics Sync

- **Export:** Read `.tff/metrics.jsonl` → include in state branch files
- **Import:** Read `metrics.jsonl` from state branch → write to `.tff/metrics.jsonl`
- **Merge:** Append child metrics to parent (metrics are append-only, no dedup needed)

### 10. Snapshot Merger Extension

Extend the S01 `Snapshot` interface and `mergeSnapshots()` to handle ship/completion records:

```typescript
export interface Snapshot {
  project?: Record<string, unknown>;
  milestones: SnapshotEntity[];
  slices: SnapshotEntity[];
  tasks: SnapshotEntity[];
  shipRecords?: SnapshotEntity[];           // NEW
  completionRecords?: SnapshotEntity[];     // NEW
}
```

Merge rules for new fields:
- `shipRecords`: child wins for records matching `sliceId === ownedSliceId`
- `completionRecords`: parent always wins (milestone-level entity)

### 11. Event Wiring (Minimal — creation only)

Wire state branch creation to existing domain events:
- `MilestoneCreatedEvent` → `createStateBranch(milestone/M##, tff-state/main)`
- `SliceCreatedEvent` → `createStateBranch(slice/S##, tff-state/milestone/M##)`

Deletion (merge-back + `deleteStateBranch()` on ship/close) is S04 scope — requires worktree lifecycle integration.

This is minimal wiring — full phase-transition sync is S04.

## Constraints

- `StateBranchOpsPort` from S01 is the ONLY interface for git operations on state branches — no direct git calls. The port uses `Map<string, string>` (not `Buffer`) as implemented in S01 — sufficient for JSON/text state snapshots
- State-snapshot.json must be human-readable and diffable (pretty-printed JSON)
- `.tff/` NEVER appears in code branch commits (invariant I1)
- Each state branch mirrors exactly one code branch (invariant I3)
- Lock timeout is non-blocking — contention skips sync, doesn't error
- SQLite repos must pass the SAME contract specs as InMemory repos — behavioral parity
- SQLite repos use INSERT OR REPLACE for upsert semantics (matches InMemory save behavior)
- Array fields in SQLite stored as JSON TEXT — no separate junction tables
- Shared `state.db` for core entities; ship/completion records keep their separate `.db` files (established pattern)
- `mergeSnapshots()` extension must remain backward-compatible (optional fields with `??` fallback)

## Acceptance Criteria

- AC1: All four SQLite repos (project, milestone, slice, task) pass their existing contract specs — behavioral parity with InMemory
- AC2: `extension.ts` wires SQLite repos backed by shared `state.db` — InMemory repos removed from production wiring
- AC3: Round-trip export → import produces identical domain state (project, milestones, slices, tasks, ship records, completion records all survive)
- AC4: Schema version tracked in state-snapshot.json; old snapshots (missing new fields) hydrate via Zod `.default()` without error
- AC5: State branches created automatically when code branches are created (milestone/slice creation events)
- AC6: Sync uses `StateBranchOpsPort` temp worktrees for writes (no direct git calls)
- AC7: Advisory lock prevents concurrent sync to same state branch; contention is non-blocking
- AC8: Journal path correctly normalized: local nested `milestones/M##/{sliceId}.jsonl` ↔ state branch flat `journal.jsonl`
- AC9: `metrics.jsonl` round-trips through state branch sync (export → import preserves all entries)

## Non-Goals

- Post-checkout hook or lazy fallback detection (S03)
- Worktree-at-discuss lifecycle change (S04)
- State reconstruction from scratch when `.tff/` is lost (S05)
- Full workflow phase-transition sync wiring (S04)
- Review/verification entities in snapshot (not required by R03)
- Performance optimization of git operations
- SQLite migration framework (CREATE TABLE IF NOT EXISTS is sufficient at this stage)
- Workflow session persistence in SQLite (ephemeral, reconstructed per CLI invocation)

## Risks

| Risk | Mitigation |
|---|---|
| SQLite repo swap breaks existing tests | Contract specs ensure behavioral parity. Run full suite after swap. |
| JSON array columns lose type safety | Parse with Zod on read; serialize with `JSON.stringify` on write. Contract tests cover array round-trips. |
| Task label uniqueness scope differs (InMemory: global, SQLite: per-slice) | InMemory allows same label across slices. SQLite UNIQUE(slice_id, label) matches this. Contract spec already tests cross-slice duplicate labels. |
| Ship/completion record repos lack `findAll()` | Add `findAll()` to both ports — small, additive change |
| Schema evolution breaks existing branch-meta.json | Zod `.default()` for all new fields; backward-compatible parse |
| Lock file not cleaned up on process crash | Stale detection via PID check; lock file includes PID + timestamp |
| Journal merge produces duplicates | Deduplicate by seq number during merge |
| Scope expansion to F-full delays delivery | SQLite repos are mechanical (known pattern, existing contract specs). Risk is breadth, not depth. |

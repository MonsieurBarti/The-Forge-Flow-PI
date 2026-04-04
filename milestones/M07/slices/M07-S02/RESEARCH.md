# Research — M07-S02: SQLite Repos + State Branch CRUD + JSON Export/Import

## 1. SQLite Repository Patterns (Proven)

### Established Pattern from SqliteShipRecordRepository

All four new SQLite repos follow this exact pattern:

```
Constructor: CREATE TABLE IF NOT EXISTS via db.exec()
Save: aggregate.toJSON() → INSERT OR REPLACE with positional params
Find: SELECT with typed Row interface → manual snake→camel mapping → Aggregate.reconstitute(props)
Date write: props.createdAt.toISOString()
Date read: new Date(row.created_at)
Nullable write: props.outcome ?? null
Nullable read: row.outcome !== null ? parse(row.outcome) : null
Array write: JSON.stringify(props.filePaths)
Array read: z.array(z.string()).parse(JSON.parse(row.file_paths))
```

### Singleton Constraint (Project)

Project's `save()` must reject when a different project ID exists — cannot use plain INSERT OR REPLACE. Pattern:

```typescript
async save(project: Project): Promise<Result<void, PersistenceError>> {
  const props = project.toJSON();
  const existing = this.db
    .prepare<[], { id: string }>("SELECT id FROM projects LIMIT 1")
    .get();
  if (existing && existing.id !== props.id) {
    return err(new PersistenceError("Project singleton violated: a different project already exists"));
  }
  this.db.prepare(/* INSERT OR REPLACE */).run(/* ... */);
  return ok(undefined);
}
```

### Task Label Uniqueness (Scoped to Slice)

Task labels are unique per-slice (not globally). SQLite constraint: `UNIQUE(slice_id, label)`. InMemory already allows same label across different slices (confirmed by contract spec test).

### Database Wiring

Single `state.db` for all four repos, created once in `extension.ts`:

```typescript
const stateDb = new Database(join(tffDir, "state.db"));
const projectRepo = new SqliteProjectRepository(stateDb);
const milestoneRepo = new SqliteMilestoneRepository(stateDb);
const sliceRepo = new SqliteSliceRepository(stateDb);
const taskRepo = new SqliteTaskRepository(stateDb);
```

Ship/completion records keep separate `.db` files (existing pattern, don't change).

## 2. Event System Integration

### Handler Registration Pattern

Proven by `JournalEventHandler` and `RecordTaskMetricsUseCase`:

```typescript
class StateBranchCreationHandler {
  constructor(
    private readonly stateSyncPort: StateSyncPort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly milestoneRepo: MilestoneRepositoryPort,
    private readonly logger: LoggerPort,
  ) {}

  register(eventBus: EventBusPort): void {
    eventBus.subscribe(EVENT_NAMES.MILESTONE_CREATED, (event) => this.onMilestoneCreated(event));
    eventBus.subscribe(EVENT_NAMES.SLICE_CREATED, (event) => this.onSliceCreated(event));
  }
}
```

### Events Available

- `MilestoneCreatedEvent` — published by `Milestone.createNew()`, contains `aggregateId` (milestone ID)
- `SliceCreatedEvent` — published by `Slice.createNew()`, contains `aggregateId` (slice ID)
- Both published after `repo.save()` via `entity.pullEvents()` → `eventBus.publish()`

### Event Limitations

Events carry only `aggregateId` and `occurredAt` — no label or parent reference. The handler must query the repo to resolve:
- Milestone: `milestoneRepo.findById(event.aggregateId)` → get `label` for branch name
- Slice: `sliceRepo.findById(event.aggregateId)` → get `label` + `milestoneId` → `milestoneRepo.findById()` → get milestone label for parent branch name

## 3. Error Types

### SyncError Pattern

```typescript
// Existing: class-based with namespaced code
new SyncError("BRANCH_NOT_FOUND", "State branch tff-state/slice/M07-S02 does not exist")
new SyncError("LOCK_CONTENTION", "Could not acquire lock within 5000ms")
new SyncError("SCHEMA_VERSION_MISMATCH", "Snapshot version 2 > code version 1")
new SyncError("EXPORT_FAILED", "Failed to export state: ...")
new SyncError("IMPORT_FAILED", "Failed to import state: ...")
```

No enum/union needed — the `code` string field discriminates. Callers check `error.code === "SYNC.BRANCH_NOT_FOUND"`.

### TimestampSchema Coercion

`TimestampSchema = z.coerce.date()` — auto-coerces ISO strings to Date objects. This means:
- **Export**: `JSON.stringify()` naturally serializes `Date → string`
- **Import**: `StateSnapshotSchema.parse(JSON.parse(raw))` coerces strings back to Dates
- **No custom serialization needed** — Zod handles the round-trip

## 4. File I/O Patterns for GitStateSyncAdapter

### Artifact Collection

`NodeArtifactFileAdapter` stores at: `.tff/milestones/{milestoneLabel}/slices/{sliceLabel}/{SPEC|PLAN|RESEARCH|CHECKPOINT}.md`

For sync export: walk `.tff/milestones/` directory tree, collect all `.md` files, map relative paths as keys in `Map<string, string>`.

`REQUIREMENTS.md` lives at: `.tff/milestones/{milestoneLabel}/REQUIREMENTS.md`

### Journal Path Normalization

Local: `.tff/milestones/{milestoneLabel}/{sliceId}.jsonl` (one per slice)
State branch: `journal.jsonl` (single flat file at root)

- **Export**: Read via `readFile()` at known path → write as `journal.jsonl` entry in file map
- **Import**: Read `journal.jsonl` from state branch → extract slice ID from entries → write to local path
- **Key insight**: Journal files are per-slice, so on a slice state branch there's only one journal file. Flattening is trivial.

### Metrics Sync

`JsonlMetricsRepository` reads/writes a single `metrics.jsonl` file (path from constructor).
- **Export**: Read `.tff/metrics.jsonl` → include as `metrics.jsonl` in file map
- **Import**: Write `metrics.jsonl` content to `.tff/metrics.jsonl`
- **Merge**: Concatenate lines (append child entries to parent). No dedup needed — metrics are append-only.

### State Branch File Map Format

`StateBranchOpsPort.syncToStateBranch()` accepts `Map<string, string>` — keys are relative file paths, values are file contents. The adapter handles directory creation, git staging, and atomic commit.

## 5. StateExporter/Importer Design

### Export Flow

```
projectRepo.findSingleton() → project (or null)
  → milestoneRepo.findByProjectId(project.id) → milestones[]
    → for each milestone: sliceRepo.findByMilestoneId(milestone.id) → slices[]
      → for each slice: taskRepo.findBySliceId(slice.id) → tasks[]
shipRecordRepo.findAll() → shipRecords[] (NEW method)
completionRecordRepo.findAll() → completionRecords[] (NEW method)

All aggregates → .toJSON() → collect into StateSnapshot → JSON.stringify(snapshot, null, 2)
```

### Import Flow

```
JSON.parse(raw) → StateSnapshotSchema.parse(parsed)
  → TimestampSchema coerces ISO strings → Date (automatic)
  → shipRecords/completionRecords arrays default to [] if missing (Zod .default())

For each entity: Aggregate.reconstitute(props) → repo.save(aggregate)
Order matters: project → milestones → slices → tasks → shipRecords → completionRecords
```

### Schema Versioning

```typescript
const SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, (old: unknown) => unknown> = {
  // Future: { 1: (v0) => ({ ...v0, newField: defaultValue }) }
};

function migrateSnapshot(raw: unknown): unknown {
  let obj = raw as Record<string, unknown>;
  let version = (obj.version as number) ?? 0;
  if (version > SCHEMA_VERSION) {
    throw new SyncError("SCHEMA_VERSION_MISMATCH", `Snapshot v${version} > code v${SCHEMA_VERSION}`);
  }
  while (version < SCHEMA_VERSION) {
    const migrator = MIGRATIONS[version];
    if (!migrator) throw new SyncError("IMPORT_FAILED", `No migration for v${version}`);
    obj = migrator(obj) as Record<string, unknown>;
    version++;
  }
  return obj;
}
```

## 6. Advisory Lock Design

```typescript
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

interface LockContent { pid: number; acquiredAt: string; }

function isProcessRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

class AdvisoryLock {
  acquire(lockPath: string, timeoutMs = 5000): Result<() => void, LockError> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(lockPath)) {
        const content: LockContent = JSON.parse(readFileSync(lockPath, "utf-8"));
        if (!isProcessRunning(content.pid)) {
          unlinkSync(lockPath); // Stale lock — break it
        } else {
          // Busy wait (short sleep) or return contention error
          continue;
        }
      }
      try {
        writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), { flag: "wx" });
        return ok(() => { try { unlinkSync(lockPath); } catch {} });
      } catch {
        continue; // Race — another process grabbed it
      }
    }
    return err(new LockError("CONTENTION", `Could not acquire lock within ${timeoutMs}ms`));
  }
}
```

Key: `writeFileSync` with `flag: "wx"` = atomic create-if-not-exists (race-safe).

## 7. Snapshot Merger Extension

Extend `Snapshot` interface and `mergeSnapshots()` (backward-compatible):

```typescript
// Extended interface — new fields optional for backward compat
export interface Snapshot {
  project?: Record<string, unknown>;
  milestones: SnapshotEntity[];
  slices: SnapshotEntity[];
  tasks: SnapshotEntity[];
  shipRecords?: SnapshotEntity[];
  completionRecords?: SnapshotEntity[];
}

export function mergeSnapshots(parent: Snapshot, child: Snapshot, sliceId: string): Snapshot {
  return {
    project: parent.project,
    milestones: mergeById(parent.milestones ?? [], child.milestones ?? [], () => false),
    slices: mergeById(parent.slices ?? [], child.slices ?? [], (e) => e.id === sliceId),
    tasks: mergeById(parent.tasks ?? [], child.tasks ?? [], (e) => e.sliceId === sliceId),
    // NEW: ship records — child wins for owned slice's records
    shipRecords: mergeById(
      parent.shipRecords ?? [], child.shipRecords ?? [],
      (e) => e.sliceId === sliceId,
    ),
    // NEW: completion records — parent always wins
    completionRecords: mergeById(
      parent.completionRecords ?? [], child.completionRecords ?? [],
      () => false,
    ),
  };
}
```

## 8. Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Shared state.db vs separate DBs | Shared `state.db` for core entities | Simpler export (one DB to read), matches S04's "own state.db" requirement |
| Export source | SQLite repos (not in-memory) | After wiring swap, SQLite IS production. Durable between invocations. |
| Date serialization | Let JSON.stringify handle Dates, Zod coerce on import | TimestampSchema = z.coerce.date() handles both directions |
| Lock mechanism | File-based with `flag: "wx"` | Atomic, no external deps, cross-platform |
| findAll() test strategy | Add to existing contract specs | Consistent with established pattern |
| Event handler location | New handler class wired in extension.ts | Follows JournalEventHandler pattern |
| StateExporter/Importer location | src/kernel/services/ | Cross-hexagon dependency — kernel is correct home |

## 9. Risks Confirmed/Mitigated

| Risk | Status | Notes |
|---|---|---|
| Array fields in SQLite | Mitigated | SqliteCompletionRecordRepository proves JSON.stringify + Zod parse pattern |
| Singleton constraint | Mitigated | SELECT before INSERT pattern identified |
| Event handler needs repo access | Mitigated | Handler receives repos via constructor (same as JournalEventHandler) |
| TimestampSchema round-trip | Confirmed safe | z.coerce.date() handles string → Date coercion |
| Lock race conditions | Mitigated | writeFileSync flag:"wx" is atomic create |

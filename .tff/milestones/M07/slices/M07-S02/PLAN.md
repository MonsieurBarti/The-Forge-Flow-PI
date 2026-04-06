# Plan — M07-S02: SQLite Repos + State Branch CRUD + JSON Export/Import

## Task Decomposition

### Wave 0 — Foundation + SQLite Repos (all parallel)

#### T01: StateSnapshotSchema + BranchMetaSchema + versioning

**Files:**
- CREATE `src/kernel/infrastructure/state-branch/state-snapshot.schemas.ts`

**Work:**
- Define `StateSnapshotSchema` (Zod): version, exportedAt, project (nullable), milestones[], slices[], tasks[], shipRecords[] (.default([])), completionRecords[] (.default([]))
- Define `BranchMetaSchema` (Zod): version, stateId, codeBranch, stateBranch, parentStateBranch (nullable), lastSyncedAt (nullable), lastJournalOffset (.default(0)), dirty (.default(false))
- `SCHEMA_VERSION = 1` constant
- `migrateSnapshot(raw)` function: version check, migration loop, abort if version > code version
- Export types: `StateSnapshot`, `BranchMeta`

**AC:** AC4

**Test:** Unit test — parse valid snapshot, parse snapshot with missing optional fields (Zod defaults), reject snapshot with version > 1

---

#### T02: Redesigned StateSyncPort + SyncError variants

**Files:**
- EDIT `src/kernel/ports/state-sync.port.ts` — replace 3-method interface with 5-method branch-aware interface
- EDIT `src/kernel/ports/state-sync.schemas.ts` — update SyncReport if needed
- EDIT `src/kernel/ports/index.ts` — update barrel exports

**Work:**
- Replace `push/pull/markDirty` with: `syncToStateBranch`, `restoreFromStateBranch`, `mergeStateBranches`, `createStateBranch`, `deleteStateBranch`
- Verify no existing callers use old methods (they're stubs — safe to remove)
- Add SyncError code constants: `BRANCH_NOT_FOUND`, `LOCK_CONTENTION`, `SCHEMA_VERSION_MISMATCH`, `EXPORT_FAILED`, `IMPORT_FAILED`

**AC:** Part of AC6

**Test:** No test needed (abstract port definition)

---

#### T03: Advisory lock utility

**Files:**
- CREATE `src/kernel/infrastructure/advisory-lock.ts`

**Work:**
- `AdvisoryLock` class with `acquire(lockPath, timeoutMs?)` → `Result<() => void, SyncError>`
- Lock file format: `{ pid, acquiredAt }` JSON
- Stale detection: `process.kill(pid, 0)` check
- Atomic create: `writeFileSync` with `flag: "wx"`
- Timeout: default 5000ms, return `LOCK_CONTENTION` error on timeout

**AC:** AC7

**Test:** Unit test — acquire succeeds, stale lock broken, contention returns error, release removes file

---

#### T04: Extend Snapshot merger with shipRecords/completionRecords

**Files:**
- EDIT `src/kernel/infrastructure/state-branch/json-snapshot-merger.ts`
- EDIT `src/kernel/infrastructure/state-branch/json-snapshot-merger.spec.ts`

**Work:**
- Add `shipRecords?: SnapshotEntity[]` and `completionRecords?: SnapshotEntity[]` to `Snapshot` interface
- Extend `mergeSnapshots()`: shipRecords child wins for `sliceId === ownedSliceId`, completionRecords parent always wins
- Use `?? []` fallbacks for backward compatibility

**AC:** Part of AC3

**Test:** Extend existing merger spec — test shipRecord merge (child wins for owned slice), completionRecord merge (parent wins), backward compat (missing fields)

---

#### T05: SqliteProjectRepository + contract spec

**Files:**
- EDIT `src/hexagons/project/infrastructure/sqlite-project.repository.ts` — replace stub with implementation
- EDIT `src/hexagons/project/infrastructure/project-repository.contract.spec.ts` — add SQLite to contract suite

**Work:**
- CREATE TABLE projects (id, name, vision, created_at, updated_at)
- `save()`: SELECT id LIMIT 1 to check singleton → INSERT OR REPLACE
- `findById()`, `findSingleton()`: SELECT → map snake_case → reconstitute
- `reset()`: DELETE FROM projects
- Add `runContractTests("SqliteProjectRepository", ...)` call to contract spec

**AC:** AC1

**Test:** Contract spec (shared with InMemory — already written)

---

#### T06: SqliteMilestoneRepository + contract spec

**Files:**
- EDIT `src/hexagons/milestone/infrastructure/sqlite-milestone.repository.ts` — replace stub
- EDIT `src/hexagons/milestone/infrastructure/milestone-repository.contract.spec.ts` — add SQLite

**Work:**
- CREATE TABLE milestones (id, project_id, label UNIQUE, title, description, status, created_at, updated_at)
- `save()`: INSERT OR REPLACE (UNIQUE on label handles constraint)
- `findById()`, `findByLabel()`, `findByProjectId()`: SELECT → map → reconstitute
- `reset()`: DELETE FROM milestones
- Handle label uniqueness: catch SQLITE_CONSTRAINT → PersistenceError with "Label uniqueness" message

**AC:** AC1

**Test:** Contract spec

---

#### T07: SqliteSliceRepository + contract spec

**Files:**
- EDIT `src/hexagons/slice/infrastructure/sqlite-slice.repository.ts` — replace stub
- EDIT `src/hexagons/slice/infrastructure/slice-repository.contract.spec.ts` — add SQLite

**Work:**
- CREATE TABLE slices (id, milestone_id, label UNIQUE, title, description, status, complexity, spec_path, plan_path, research_path, created_at, updated_at)
- `save()`, `findById()`, `findByLabel()`, `findByMilestoneId()`: standard pattern
- `reset()`: DELETE FROM slices
- Nullable fields: complexity, spec_path, plan_path, research_path

**AC:** AC1

**Test:** Contract spec

---

#### T08: SqliteTaskRepository + contract spec

**Files:**
- EDIT `src/hexagons/task/infrastructure/sqlite-task.repository.ts` — replace stub
- EDIT `src/hexagons/task/infrastructure/task-repository.contract.spec.ts` — add SQLite

**Work:**
- CREATE TABLE tasks (id, slice_id, label, title, description, acceptance_criteria, file_paths JSON, status, blocked_by JSON, wave_index, created_at, updated_at, UNIQUE(slice_id, label))
- `save()`: label uniqueness check (SELECT by slice_id + label, different id) → INSERT OR REPLACE
- Array columns: `JSON.stringify()` write, `z.array().parse(JSON.parse())` read
- `findById()`, `findByLabel()`, `findBySliceId()`: standard pattern
- `reset()`: DELETE FROM tasks

**AC:** AC1

**Test:** Contract spec (includes cross-slice label test)

---

#### T09: findAll() + reset() on ship/completion record repos

**Files:**
- EDIT `src/hexagons/review/domain/ports/ship-record-repository.port.ts` — add `findAll()`
- EDIT `src/hexagons/review/domain/ports/completion-record-repository.port.ts` — add `findAll()`
- EDIT `src/hexagons/review/infrastructure/repositories/ship-record/sqlite-ship-record.repository.ts` — implement `findAll()` + `reset()`
- EDIT `src/hexagons/review/infrastructure/repositories/completion-record/sqlite-completion-record.repository.ts` — implement `findAll()` + `reset()`
- EDIT InMemory variants — implement `findAll()` (iterate store values)
- EDIT barrel exports if needed

**Work:**
- `findAll()`: SELECT * → map all rows → reconstitute
- `reset()`: DELETE FROM <table>
- InMemory `findAll()`: Array.from(store.values()).map(reconstitute)

**AC:** Part of AC3

**Test:** Add `findAll()` test to existing specs. Verify empty returns [], populated returns all.

---

### Wave 1 — Export/Import Services (depends on Wave 0)

#### T10: StateExporter service + tests

**Files:**
- CREATE `src/kernel/services/state-exporter.ts`
- CREATE `src/kernel/services/state-exporter.spec.ts`

**Work:**
- Constructor: inject all 6 repo ports (project, milestone, slice, task, shipRecord, completionRecord)
- `export()`: chain repo queries (findSingleton → findByProjectId → findByMilestoneId → findBySliceId, findAll for ship/completion), collect all `.toJSON()` props, build `StateSnapshot` with `SCHEMA_VERSION` and `exportedAt`
- Return `Result<StateSnapshot, SyncError>`

**AC:** Part of AC3

**Test:** Unit test with InMemory repos — seed entities, export, verify snapshot has all entities with correct props

---

#### T11: StateImporter service + round-trip test

**Files:**
- CREATE `src/kernel/services/state-importer.ts`
- CREATE `src/kernel/services/state-importer.spec.ts`

**Work:**
- Constructor: inject all 6 repo ports
- `import(snapshot: StateSnapshot)`: validate via `StateSnapshotSchema.parse()` (with `migrateSnapshot` pre-pass), reconstitute + save in order (project → milestones → slices → tasks → shipRecords → completionRecords)
- Return `Result<void, SyncError>`

**AC:** AC3, AC4

**Test:**
- Unit test: import snapshot → verify all entities saved to repos
- Round-trip test: seed repos → export → clear repos → import → compare (all entity props identical)
- Schema version test: import snapshot with missing optional fields → Zod defaults fill in

---

### Wave 2 — StateSyncPort Adapter (depends on Wave 1)

#### T12: GitStateSyncAdapter — create, delete, sync

**Files:**
- CREATE `src/kernel/infrastructure/state-branch/git-state-sync.adapter.ts`
- CREATE `src/kernel/infrastructure/state-branch/git-state-sync.adapter.spec.ts`

**Work:**
- Constructor: inject `StateBranchOpsPort`, `StateExporter`, `AdvisoryLock`, tffDir, projectRoot
- `createStateBranch(codeBranch, parentStateBranch)`: forkBranch + write initial branch-meta.json
- `deleteStateBranch(codeBranch)`: deleteBranch
- `syncToStateBranch(codeBranch, tffDir)`: acquire lock → export → collect artifacts (walk .tff/milestones/) + normalize journal + include metrics.jsonl + write state-snapshot.json + branch-meta.json + settings.yaml → syncToStateBranch → update local branch-meta → release lock

**AC:** AC5, AC6, AC7, AC8, AC9

**Test:** Unit test with mocked StateBranchOpsPort — verify file map contents, lock acquire/release, journal normalization, metrics inclusion

---

#### T13: GitStateSyncAdapter — restore, merge

**Files:**
- EDIT `src/kernel/infrastructure/state-branch/git-state-sync.adapter.ts` — add remaining methods
- EDIT `src/kernel/infrastructure/state-branch/git-state-sync.adapter.spec.ts` — add tests

**Work:**
- `restoreFromStateBranch(codeBranch, tffDir)`: acquire lock → readAll from state branch → parse state-snapshot.json (with migration) → import via StateImporter → write artifacts to local paths → denormalize journal → write metrics → update branch-meta → release lock
- `mergeStateBranches(child, parent, sliceId)`: read both snapshots → mergeSnapshots (extended from T04) → merge metrics (concat) → merge artifacts → write to parent branch

**AC:** AC3, AC6, AC8, AC9

**Test:** Unit test — restore populates repos + writes artifacts, merge produces correct merged state

---

### Wave 3 — Integration (depends on Wave 2)

#### T14: StateBranchCreationHandler + event wiring

**Files:**
- CREATE `src/kernel/infrastructure/state-branch/state-branch-creation.handler.ts`
- CREATE `src/kernel/infrastructure/state-branch/state-branch-creation.handler.spec.ts`

**Work:**
- Constructor: inject `StateSyncPort`, `MilestoneRepositoryPort`, `SliceRepositoryPort`, `LoggerPort`
- `register(eventBus)`: subscribe to `MILESTONE_CREATED` and `SLICE_CREATED`
- `onMilestoneCreated`: findById → resolve label → `createStateBranch(milestone/{label}, tff-state/main)`
- `onSliceCreated`: findById → resolve label + milestoneId → findMilestoneById → `createStateBranch(slice/{label}, tff-state/milestone/{milestoneLabel})`
- Error handling: log and continue (don't block aggregate save)

**AC:** AC5

**Test:** Unit test with mocked ports — verify correct branch names, error logging on failure

---

#### T15: Extension.ts wiring swap + verification

**Files:**
- EDIT `src/cli/extension.ts` — replace InMemory repos with SQLite repos

**Work:**
- Create shared `state.db`: `new Database(join(tffDir, "state.db"))`
- Replace `InMemoryProjectRepository` → `SqliteProjectRepository(stateDb)`
- Replace `InMemoryMilestoneRepository` → `SqliteMilestoneRepository(stateDb)`
- Replace `InMemorySliceRepository` → `SqliteSliceRepository(stateDb)`
- Replace `InMemoryTaskRepository` → `SqliteTaskRepository(stateDb)`
- Create `GitStateSyncAdapter` and wire into extension
- Create `StateBranchCreationHandler`, call `.register(eventBus)`
- Update imports

**AC:** AC2

**Test:** Run full test suite — verify no regressions. Existing integration/e2e tests exercise the wiring.

---

## Wave Summary

| Wave | Tasks | Parallelism | Focus |
|---|---|---|---|
| 0 | T01–T09 | 9 parallel | Schemas, ports, SQLite repos, utilities |
| 1 | T10–T11 | 2 parallel | State export/import services |
| 2 | T12–T13 | 2 sequential | GitStateSyncAdapter (sync → restore/merge) |
| 3 | T14–T15 | 2 parallel | Event wiring + extension swap |

## Dependency Graph

```
T01 (schemas) ──────────┐
T02 (port) ─────────────┤
T03 (lock) ─────────────┤
T04 (merger ext) ────────┤
T05 (sqlite-project) ───┤
T06 (sqlite-milestone) ─┼──→ T10 (exporter) ──┐
T07 (sqlite-slice) ─────┤    T11 (importer) ──┼──→ T12 (sync adapter) ──→ T13 (restore/merge) ──┐
T08 (sqlite-task) ──────┤                     │                                                  │
T09 (findAll/reset) ────┘                     └──────────────────────────────────────────────────┼──→ T14 (event handler)
                                                                                                 └──→ T15 (wiring swap)
```

## Complexity

**F-full** — 15 tasks across 4 waves. Two concern areas (local SQLite + state branch sync) spanning kernel + 6 hexagons. Risk is breadth, not depth — each task follows a proven pattern.

# M07-S02 Verification Report

## Summary

**Verdict: PASS** — All 9 acceptance criteria met with evidence.

## Acceptance Criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC1: All four SQLite repos pass contract specs — behavioral parity with InMemory | PASS | SqliteProjectRepository (6 tests), SqliteMilestoneRepository (8 tests), SqliteSliceRepository (8 tests), SqliteTaskRepository (9 tests) — all contract specs pass with identical behavior to InMemory variants. |
| AC2: `extension.ts` wires SQLite repos backed by shared `state.db` | PASS | `extension.ts:124` creates shared `new Database(join(tffDir, "state.db"))`. Lines 127-130 wire all four core repos to it. No InMemory repos used for core entities. |
| AC3: Round-trip export → import produces identical domain state | PASS | `state-importer.spec.ts` round-trip test: seed repos → export → reset → import → compare. Project, milestones, slices, tasks, ship records, completion records all survive. `StateImporter.import()` resets all repos before reconstituting (clean restore). |
| AC4: Schema version tracked; old snapshots hydrate via Zod `.default()` without error | PASS | `StateSnapshotSchema` with `version: z.literal(1)`, `SCHEMA_VERSION = 1`, `migrateSnapshot()`. `shipRecords`/`completionRecords` use `.default([])`. Schema test confirms missing optional fields hydrate correctly. |
| AC5: State branches created automatically on milestone/slice creation events | PASS | `StateBranchCreationHandler` subscribes to `MILESTONE_CREATED` → `createStateBranch(milestone/{label}, tff-state/main)` and `SLICE_CREATED` → `createStateBranch(slice/{label}, tff-state/milestone/{milestoneLabel})`. Registered in `extension.ts:381`. |
| AC6: Sync uses `StateBranchOpsPort` temp worktrees — no direct git calls | PASS | `GitStateSyncAdapter` exclusively uses injected `StateBranchOpsPort`. No `execFile`/`git` imports. Verified by reading full adapter implementation. |
| AC7: Advisory lock prevents concurrent sync; contention is non-blocking | PASS | `AdvisoryLock` at `src/kernel/infrastructure/state-branch/advisory-lock.ts`. `wx` flag for atomic create, stale PID detection via `process.kill(pid, 0)`, 5000ms timeout returns `LOCK_CONTENTION` error. All three sync methods acquire lock in try/finally. |
| AC8: Journal path normalized: local `milestones/M##/{sliceId}.jsonl` ↔ state branch flat `journal.jsonl` | PASS | `collectJournal()` walks `milestones/` for `.jsonl` files → writes flat `journal.jsonl`. `restoreFromStateBranch` writes `journal.jsonl` back to nested local path. |
| AC9: `metrics.jsonl` round-trips through state branch sync | PASS | `syncToStateBranch` reads `.tff/metrics.jsonl` → includes in file map. `restoreFromStateBranch` writes `metrics.jsonl` back to `.tff/metrics.jsonl`. Merge concatenates child entries to parent. |

## Test Evidence

```
npx vitest run → 1824 pass, 1 skip, 0 fail (full suite)
```

Contract specs: 62 tests (12 project + 16 milestone + 16 slice + 18 task)
StateExporter: 2 tests | StateImporter: 3 tests (including round-trip)
StateSnapshotSchema: 7 tests | AdvisoryLock: 4 tests
GitStateSyncAdapter: 9 tests | StateBranchCreationHandler: 4 tests
JsonSnapshotMerger (extended): 9 tests

## Review Findings Fixed

| Finding | Severity | Fix |
|---|---|---|
| B1: `mergeStateBranches` dropped `version`/`exportedAt` | Blocker | Preserved in merged snapshot |
| H-01: No path traversal guard in `restoreFromStateBranch` | High | `path.resolve` + `startsWith` guard added |
| H-02: No Zod validation in `mergeStateBranches` | High | `migrateSnapshot` + `StateSnapshotSchema.parse()` applied |
| W3: StateImporter additive (stale entities survive restore) | Warning | `reset()` on all repos before import; `reset()` added to all 6 ports |
| W5: `mergeStateBranches` missing advisory lock | Warning | Lock acquired in try/finally |
| W6: Empty parent metrics produces leading newline | Warning | Guard: `parentMetrics && !parentMetrics.endsWith("\n")` |

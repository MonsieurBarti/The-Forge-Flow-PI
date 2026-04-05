# Verification — M07-S04: Worktree Isolation + Rename + Merge-Back

**Date:** 2026-04-04
**Tests:** 1914 passed, 0 failed
**TypeScript:** 0 new errors (11 pre-existing from S01-S03)
**Verdict:** PASS

## Acceptance Criteria

| AC | Criterion | Verdict | Evidence |
|---|---|---|---|
| AC1 | Worktree created at discuss | **PASS** | `start-discuss.use-case.ts:55-58` — `createWorkspace()` called; failure returns error. Test: `start-discuss.use-case.spec.ts:193-217` |
| AC2 | Worktree .tff/ contains correct files, excludes worktrees/.lock/backups | **PASS** | `git-worktree.adapter.ts:141-152` — `EXCLUDE_NAMES` set + `.tff.backup.*` filter. Fresh `branch-meta.json` written at L169. Contract test: `worktree.contract.spec.ts:99-119` |
| AC3 | Independent state.db per worktree | **PASS** | Each worktree at `<root>/.tff/worktrees/<sliceId>/.tff/` with its own DB copy. `InMemoryWorktreeAdapter` uses per-slice Map. |
| AC4 | Ship merge-back: sync → merge → delete state → delete worktree → restore | **PASS** | `ship-slice.use-case.ts:160-191` — Full sequence implemented, each step fails fast. |
| AC5 | Ship merge-back failure aborts with actionable error; idempotent re-run | **PASS** | `ShipError.mergeBackFailed` at L167,170,173,190. PR creation idempotent (L88-109). |
| AC6 | Complete-milestone merges state into default branch | **PASS** | `complete-milestone.use-case.ts:228-244` — sync → merge → delete → restore. |
| AC7 | Complete-milestone refuses if slices not closed | **PASS** | `complete-milestone.use-case.ts:63-77` — `openSlicesRemaining` error. Test: spec L417-435. |
| AC8 | Rename detection renames state branch + updates meta | **PASS** | `branch-consistency-guard.ts:109-132` — `handleRename()`. Test: spec L280-296 (0 restore calls). |
| AC9 | 3-way disambiguate: rename/switch/untracked/ambiguous | **PASS** | `branch-consistency-guard.ts:65-107` — stateId tiebreaker. Tests: spec L255,268,281,299,317 cover all 5 cases. |
| AC10 | WorktreePort in kernel, imported via @kernel | **PASS** | `kernel/ports/worktree.port.ts`. Imported by workflow, execution, review via `@kernel/ports/worktree.port`. |
| AC11 | ExecuteSliceUseCase unchanged | **PASS** | `execute-slice.use-case.ts:208-210` — Still checks `worktree.exists()`, does not create. |
| AC12 | Rollback on partial setup failure | **PASS** | `start-discuss.use-case.ts:136-165` — Deletes worktree/state branch on failure. Test: spec L219-244. |
| AC13 | GitPort.branchExists() works correctly | **PASS** | `git-cli.adapter.ts:282-293` — `rev-parse --verify`. Integration test: spec L281-293. |
| AC14 | All existing tests pass after relocation | **PASS** | 1914/1914 pass. |
| AC15 | Discuss/research/plan operate within worktree | **PASS** | Worktree created at discuss with own `.tff/`. `resolveActiveTffDir` routes to worktree path. |
| AC16 | Concurrent sync safe — independent locks and branches | **PASS** | Per-worktree `.tff/` → per-worktree `.lock`. Per-slice state branches. |
| AC17 | initializeWorkspace failure cleans up partial .tff/ | **PASS** | `git-worktree.adapter.ts:175-183` — `rm(targetTffDir)` in catch block. |

## Test Evidence

```
PASS (1914) FAIL (0)
TypeScript: 0 new errors (11 pre-existing in 4 files from S01-S03)
```

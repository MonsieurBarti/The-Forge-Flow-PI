# M07-S04: Worktree Isolation + Rename + Merge-Back

## Prerequisites

S04 builds on `milestone/M07` branch which carries S01–S03 work:
- `StateBranchOpsPort` + `GitStateBranchOpsAdapter` (S01)
- `StateSyncPort` (redesigned) + `GitStateSyncAdapter` + `StateExporter` + `StateImporter` (S02)
- `BranchMetaSchema`, `StateSnapshotSchema`, `AdvisoryLock` (S02)
- `RestoreStateUseCase` + `BranchConsistencyGuard` + `DoctorService` + `BackupService` (S03)

## Problem

Worktree creation currently happens outside the codebase (not wired into any use case). `ExecuteSliceUseCase` validates that a worktree exists but doesn't create one. This means:

1. **No workspace isolation from discuss.** The slice lifecycle (discuss → research → plan → execute → ship) should operate within its own worktree from the start — not just during execution. Without this, discuss/research/plan phases modify the parent milestone's `.tff/` state directly, making parallel slice work impossible.

2. **No merge-back.** When a slice ships, its worktree state (`.tff/state.db`, artifacts) must merge back into the milestone's state. When a milestone completes, its state must merge into `tff-state/{defaultBranch}`. Neither path exists.

3. **No rename detection.** If a user renames a branch outside TFF (`git branch -m`), the `branch-meta.json` points to a stale code branch name. The guard incorrectly triggers a restore instead of updating refs.

## Approach

Direct use-case orchestration for both setup and teardown. Synchronous, fail-fast, errors bubble to user immediately. No event-driven indirection.

### Port relocation

Move `WorktreePort` from `execution/domain/ports/` to `kernel/ports/` — it's now a cross-hexagon concern (workflow creates, execution uses, review deletes). All schemas (`WorktreeInfo`, `WorktreeHealth`, `WorktreeError`) move with it.

### Worktree-at-discuss

`StartDiscussUseCase` extended to create the full workspace:
1. Create git worktree based on milestone branch
2. Create slice state branch (forked from milestone state branch)
3. Copy `.tff/` into worktree with fresh `branch-meta.json`

Rollback on partial failure: delete whatever was created, return error, discuss doesn't start.

### Merge-back on ship

`ShipSliceUseCase` extended with merge-back after PR merge:
1. Sync worktree state to slice state branch
2. Merge slice state into milestone state (entity-ID JSON merge via `StateSyncPort.mergeStateBranches`)
3. Delete slice state branch
4. Delete worktree
5. Restore top-level `.tff/` from milestone state branch

Failure aborts ship with actionable error.

### Merge-back on complete-milestone

Extend existing `CompleteMilestoneUseCase` in `review/application/` (handles audit, PR, merge gate). Insert state merge-back between step 5 (merge gate loop — PR merged) and step 6 (branch cleanup). This mirrors how `ShipSliceUseCase` is extended rather than replaced.

Inserted steps:
1. Sync milestone state to its state branch
2. Merge milestone state into `tff-state/{defaultBranch}` (entity-ID JSON merge)
3. Delete milestone state branch
4. Restore top-level `.tff/` from default branch state

### Worktree-scoped phases

Once the worktree is created at discuss, all subsequent phases (discuss, research, plan, execute, ship) operate within it. The key mechanism: the workflow's `tffDir` resolves to the worktree's `.tff/` path (via `WorktreePort.resolveTffDir(sliceId)`), not the project root's `.tff/`. This means:

- `WriteSpecUseCase`, `WriteResearchUseCase`, `WritePlanUseCase` write artifacts into the worktree's `.tff/milestones/`
- `ClassifyComplexityUseCase` updates the worktree's `state.db`
- `ExecuteSliceUseCase` (unchanged) operates in the worktree that already exists
- All phase transitions update the worktree's `state.db`

The `tffDir` parameter is resolved once per CLI invocation based on the current working directory (if inside a worktree) or the active slice's worktree path (if on the milestone branch). This resolution happens in `extension.ts` wiring.

### Rename detection

`BranchConsistencyGuard` extended with 3-way disambiguate using `stateId`:

| Old branch exists? | State for current exists? | Diagnosis |
|---|---|---|
| Yes | Yes | Normal switch → restore |
| Yes | No | Switch to untracked branch → ok |
| No | No | Rename → rename state branch + update branch-meta |
| No | Yes | Ambiguous → compare stateId. Match → rename. No match → old deleted, restore. |

## Ports & Interfaces

### WorktreePort (moved to kernel, extended)

```typescript
// kernel/ports/worktree.port.ts
export abstract class WorktreePort {
  // Existing — unchanged
  abstract create(sliceId: string, baseBranch: string): Promise<Result<WorktreeInfo, WorktreeError>>;
  abstract delete(sliceId: string): Promise<Result<void, WorktreeError>>;
  abstract list(): Promise<Result<WorktreeInfo[], WorktreeError>>;
  abstract exists(sliceId: string): Promise<boolean>;
  abstract validate(sliceId: string): Promise<Result<WorktreeHealth, WorktreeError>>;

  // New — copies .tff/ into worktree + writes branch-meta.json
  abstract initializeWorkspace(
    sliceId: string,
    sourceTffDir: string,
    branchMeta: BranchMeta,
  ): Promise<Result<void, WorktreeError>>;

  // New — resolves worktree .tff/ path from sliceId
  abstract resolveTffDir(sliceId: string): string;
}
```

### GitPort extension

Add `branchExists(name: string): Promise<Result<boolean, GitError>>` — needed for rename detection on code branches.

### StateSyncPort — no changes

S02 replaces the old 3-method port (`push`, `pull`, `markDirty`) with the branch-aware 5-method interface (`syncToStateBranch`, `restoreFromStateBranch`, `mergeStateBranches`, `createStateBranch`, `deleteStateBranch`). S04 consumes that interface as-is — no further modifications. S04 must be developed on `milestone/M07` after S01–S03 are merged.

### Rename detection types

```typescript
// kernel/schemas/rename-detection.schemas.ts
export const RenameDetectionResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("match") }),
  z.object({ kind: z.literal("switch") }),
  z.object({ kind: z.literal("rename"), newBranch: z.string() }),
  z.object({ kind: z.literal("untracked") }),
]);
```

### CompleteMilestoneRequest — extended

The existing `CompleteMilestoneRequestSchema` in `review/domain/completion.schemas.ts` gains a `defaultBranch` field (the git default branch name, e.g. "main"). This is the target for state merge-back. Added with Zod `.default("main")` for backward compatibility.

## Use Cases

### StartDiscussUseCase — extended

Current deps: `SliceRepositoryPort`, `WorkflowSessionRepositoryPort`, `EventBusPort`, `DateProviderPort`, `AutonomyModeProvider`.

New deps: `WorktreePort`, `StateSyncPort`, `MilestoneRepositoryPort`, `GitPort`.

New flow (steps 1–4 new, 5–8 existing):

```
1. Validate slice exists → get milestoneId
2. Load milestone → derive baseBranch ("milestone/{label}"), parentStateBranch ("tff-state/milestone/{label}")
3. Create workspace:
   a. WorktreePort.create(sliceId, baseBranch) → WorktreeInfo
   b. StateSyncPort.createStateBranch(sliceCodeBranch, parentStateBranch)
   c. WorktreePort.initializeWorkspace(sliceId, tffDir, freshBranchMeta)
4. If any of 3a–3c fails → rollback (delete created resources) → return error
5. Find/create WorkflowSession (existing)
6. Assign slice to session (existing)
7. Trigger "start" transition: idle → discussing (existing)
8. Publish events (existing)
```

### ShipSliceUseCase — extended

New deps: `StateSyncPort`, `MilestoneRepositoryPort`.

Inserts merge-back after PR merge, before existing cleanup:

```
... (existing: validate, create PR, merge gate loop) ...

N.   Merge-back:
     a. StateSyncPort.syncToStateBranch(sliceCodeBranch, worktreeTffDir)
     b. StateSyncPort.mergeStateBranches(sliceCodeBranch, milestoneCodeBranch, sliceId)
     c. StateSyncPort.deleteStateBranch(sliceCodeBranch)
N+1. WorktreePort.delete(sliceId) (existing)
N+2. StateSyncPort.restoreFromStateBranch(milestoneCodeBranch, tffDir)
N+3. Transition to closed + emit event (existing)
```

Merge-back failure → `ShipError.mergeBackFailed(sliceId, cause)` → ship aborts.

### CompleteMilestoneUseCase — extended

Location: `src/hexagons/review/application/complete-milestone.use-case.ts` (existing).

New dep: `StateSyncPort`.

Insert state merge-back between existing step 5 (merge gate loop exits on "merged") and step 6 (post-merge branch cleanup):

```
... (existing steps 1–5: guard, audit, PR, completion record, merge gate) ...

Step 5.5: State merge-back (NEW):
  a. StateSyncPort.syncToStateBranch(milestoneCodeBranch, tffDir)
  b. StateSyncPort.mergeStateBranches(milestoneCodeBranch, defaultBranch, milestoneId)
  c. StateSyncPort.deleteStateBranch(milestoneCodeBranch)
  d. StateSyncPort.restoreFromStateBranch(defaultBranch, tffDir)

... (existing steps 6–10: branch cleanup, close milestone, record merge, emit event, return) ...
```

`defaultBranch` comes from the extended `CompleteMilestoneRequest.defaultBranch` field.

Merge-back failure → `CompleteMilestoneError.mergeBackFailed(milestoneId, cause)` → aborts before branch cleanup. The PR is already merged but state isn't reconciled — error tells user exactly what failed.

### BranchConsistencyGuard — rename detection

New deps: `GitPort` (branchExists), `StateBranchOpsPort` (branchExists, renameBranch, readFromStateBranch).

Extended `ensure()` replaces the simple mismatch → restore logic with 3-way disambiguate:

```
1. currentBranch = GitPort.currentBranch()
2. If null (detached HEAD) → ok
3. Read branch-meta.json → meta
4. If meta.codeBranch === currentBranch → ok (match)
5. oldExists = GitPort.branchExists(meta.codeBranch)
6. stateForCurrent = StateBranchOpsPort.branchExists("tff-state/{currentBranch}")
7. Disambiguate per table above
8. Rename → StateBranchOpsPort.renameBranch(meta.stateBranch, "tff-state/{currentBranch}") + update branch-meta
9. Switch → RestoreStateUseCase.execute(currentBranch)
10. Untracked → ok
```

## Infrastructure Adapters

### GitWorktreeAdapter — moved + extended

Move from `execution/infrastructure/git-worktree.adapter.ts` to `kernel/infrastructure/worktree/git-worktree.adapter.ts`.

Existing methods unchanged. New methods:

**initializeWorkspace(sliceId, sourceTffDir, branchMeta):**
1. Resolve worktree `.tff/` path
2. Copy from sourceTffDir: `settings.yaml`, `state.db`, `milestones/`, `PROJECT.md`, `docs/`
3. Skip: `worktrees/`, `.lock`, `.tff.backup.*`, `beads-snapshot.jsonl`, `branch-meta.json`
4. Write fresh `branch-meta.json` from branchMeta param (pretty-printed JSON)

Copy uses `fs.cp(src, dest, { recursive: true, filter })`. `state.db` copied as binary — safe when no connections open (CLI opens/closes per invocation).

**resolveTffDir(sliceId):**
Returns `path.join(projectRoot, ".tff", "worktrees", sliceId, ".tff")`.

### InMemoryWorktreeAdapter — extended

`initializeWorkspace` stores branchMeta in the in-memory map (no-op for filesystem). `resolveTffDir` returns `/mock/.tff/worktrees/{sliceId}/.tff/`.

### GitCliAdapter — branchExists

```typescript
async branchExists(name: string): Promise<Result<boolean, GitError>> {
  // git rev-parse --verify refs/heads/{name}
  // exit 0 → true, exit 128 → false
}
```

### BranchConsistencyGuard — rename logic

Private `disambiguate(meta, currentBranch)` method implements the 3-way table. On rename: calls `StateBranchOpsPort.renameBranch()` + rewrites local `branch-meta.json`. On switch: delegates to `RestoreStateUseCase` (existing S03 flow).

## Wiring & Integration

### extension.ts

- Import `WorktreePort` from `@kernel` (not `@hexagons/execution`)
- Single `GitWorktreeAdapter` instance shared across all consumers
- Pass `WorktreePort` + `StateSyncPort` + `MilestoneRepositoryPort` to `StartDiscussUseCase`
- Pass `StateSyncPort` + `MilestoneRepositoryPort` to `ShipSliceUseCase`
- Pass `StateSyncPort` to `CompleteMilestoneUseCase` (existing, extended)
- Pass `GitPort` + `StateBranchOpsPort` to `BranchConsistencyGuard`

### Barrel exports

- `kernel/index.ts` — add `WorktreePort`, `WorktreeInfo`, `WorktreeHealth`, `WorktreeError`, `RenameDetectionResultSchema`
- `execution/index.ts` — remove `WorktreePort` re-exports

### Import migration

All files importing `WorktreePort` from `@hexagons/execution` switch to `@kernel` (execution, review hexagons, CLI, tests).

### tffDir resolution

`extension.ts` resolves `tffDir` per CLI invocation:
- If CWD is inside a worktree (detected via path prefix `.tff/worktrees/`) → use that worktree's `.tff/`
- If an active slice has a worktree → use `WorktreePort.resolveTffDir(sliceId)`
- Otherwise → use project root `.tff/`

This ensures all use cases receive the correct `tffDir` without individual modification.

## Acceptance Criteria

| AC | Criterion |
|---|---|
| AC1 | Worktree created at discuss — `StartDiscussUseCase` creates worktree + state branch + initializes workspace. Failure → discuss doesn't start. |
| AC2 | Worktree `.tff/` contains `settings.yaml`, `state.db`, `milestones/`, `PROJECT.md`, `docs/`, fresh `branch-meta.json`. Does NOT contain `worktrees/`, `.lock`, `.tff.backup.*`, `beads-snapshot.jsonl`. |
| AC3 | Two worktrees on different slices have independent `state.db` — changes in one don't affect the other. |
| AC4 | Ship merge-back: worktree state synced → merged into milestone state → slice state branch deleted → worktree deleted → top-level `.tff/` restored from milestone state. |
| AC5 | Ship merge-back failure → ship aborts with actionable error. Re-running ship converges to correct state (merge-back is idempotent). |
| AC6 | Complete-milestone merges milestone state into `tff-state/{defaultBranch}` → deletes milestone state branch → restores top-level `.tff/`. Merged state contains all milestone entities. |
| AC7 | Complete-milestone refuses if any slice is not closed. |
| AC8 | Rename detection: branch renamed outside TFF → guard renames state branch + updates `branch-meta.json`. No restore triggered. |
| AC9 | 3-way disambiguate correctly distinguishes rename vs switch vs untracked vs ambiguous (stateId tiebreaker). Ambiguous case with stateId mismatch falls back to restore. |
| AC10 | `WorktreePort` in kernel — imported by workflow, execution, review via `@kernel`. |
| AC11 | `ExecuteSliceUseCase` unchanged — validates worktree exists, reuses worktree created at discuss. |
| AC12 | Rollback on partial setup failure: created resources cleaned up before returning error. |
| AC13 | `GitPort.branchExists()` correctly reports code branch existence. |
| AC14 | All existing tests pass after `WorktreePort` relocation. |
| AC15 | Discuss/research/plan phases operate within the worktree — artifacts written to worktree `.tff/`, state changes in worktree `state.db`. |
| AC16 | Concurrent sync from two worktrees (different slices) does not deadlock or corrupt — each worktree has its own `.tff/.lock` and its own state branch. |
| AC17 | `initializeWorkspace` failure leaves no partial `.tff/` in worktree — cleanup on error. |

## Non-Goals

- State reconstruction from parent when `.tff/` is lost (S05)
- `/tff:sync` manual command (S05)
- Pre-dispatch guardrails, reflection, downshift (S06)
- Remote push of state branches
- Incremental/delta sync (full snapshot per sync)
- Optimizing git operation performance

## Risks

| Risk | Mitigation |
|---|---|
| `state.db` copy while connection open | CLI opens/closes per invocation — no long-lived connections. Copy in `initializeWorkspace` runs before any DB access in the worktree. |
| Import migration breaks tests | Mechanical change — search-replace `@hexagons/execution` → `@kernel` for WorktreePort imports. Run full suite after. |
| Merge-back after PR merge leaves inconsistent state on failure | Error is actionable — user sees exactly what failed. Re-running ship is idempotent for merge-back steps (syncToStateBranch overwrites, mergeStateBranches is deterministic). |
| Rename detection false positive | stateId tiebreaker resolves ambiguity. Worst case: unnecessary restore (safe, just slower). |
| `CompleteMilestoneUseCase` called with open slices | Guarded by step 1 validation — refuses with clear error listing unclosed slices. |
| Existing `CompleteMilestoneUseCase` tests break | Extending constructor signature with `StateSyncPort` breaks all existing tests. Fix: add optional param with no-op default, or update test factories. Mechanical. |
| Milestone not found when deriving baseBranch in `StartDiscussUseCase` | Explicit error: `MilestoneNotFoundError` returned before any workspace creation. No partial state. |

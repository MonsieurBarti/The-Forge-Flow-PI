# Plan — M07-S04: Worktree Isolation + Rename + Merge-Back

## Summary

Move `WorktreePort` → kernel (cross-hexagon). Extend `StartDiscussUseCase` ⇒ workspace creation at discuss. Extend `ShipSliceUseCase` ∧ `CompleteMilestoneUseCase` ⇒ merge-back via `StateSyncPort`. Extend `BranchConsistencyGuard` ⇒ 3-way rename detection. Split `tffDir` ⇒ `rootTffDir` + `activeTffDir`.

**Prerequisites:** S01–S03 merged on `milestone/M07`. All tasks target that branch.

## Task Table

| # | Title | Files | Deps | Wave |
|---|---|---|---|---|
| T01 | WorktreePort relocation to kernel | kernel/ports/, kernel/errors/, kernel/infrastructure/worktree/, kernel/index.ts, execution/index.ts, 5 consumer files | — | 0 |
| T02 | WorktreePort extension (initializeWorkspace + resolveTffDir) | kernel/ports/worktree.port.ts, kernel/infrastructure/worktree/*.ts, kernel/infrastructure/worktree/*.spec.ts | T01 | 1 |
| T03 | GitPort.branchExists + RenameDetectionResult schema | kernel/ports/git.port.ts, kernel/infrastructure/git/*.ts, kernel/schemas/rename-detection.schemas.ts | — | 0 |
| T04 | Error factory additions (ShipError + CompleteMilestoneError) | review/domain/errors/ship.error.ts, review/domain/errors/complete-milestone.error.ts | — | 0 |
| T05 | tffDir resolution split (rootTffDir + activeTffDir) | cli/extension.ts, workflow/infrastructure/pi/workflow.extension.ts | T01 | 1 |
| T06 | StartDiscussUseCase workspace creation | workflow/use-cases/start-discuss.use-case.ts, workflow/use-cases/start-discuss.use-case.spec.ts | T02, T05 | 2 |
| T07 | ShipSliceUseCase merge-back | review/application/ship-slice.use-case.ts, review/application/ship-slice.use-case.spec.ts | T02, T04, T05 | 2 |
| T08 | CompleteMilestoneUseCase merge-back | review/application/complete-milestone.use-case.ts, review/application/complete-milestone.use-case.spec.ts | T04, T05 | 2 |
| T09 | BranchConsistencyGuard rename detection | kernel/infrastructure/ (S03 guard file), kernel/infrastructure/*.spec.ts | T03 | 1 |
| T10 | Wiring + integration test | cli/extension.ts, workflow/infrastructure/pi/workflow.extension.ts | T06, T07, T08, T09 | 3 |

## Task Details

---

### T01: WorktreePort relocation to kernel

**AC refs:** AC10, AC14

**Files:**

| Action | Path |
|---|---|
| move | `execution/domain/ports/worktree.port.ts` → `kernel/ports/worktree.port.ts` |
| move | `execution/domain/worktree.schemas.ts` → `kernel/ports/worktree.schemas.ts` |
| move | `execution/domain/errors/worktree.error.ts` → `kernel/errors/worktree.error.ts` |
| move | `execution/infrastructure/git-worktree.adapter.ts` → `kernel/infrastructure/worktree/git-worktree.adapter.ts` |
| move | `execution/infrastructure/in-memory-worktree.adapter.ts` → `kernel/infrastructure/worktree/in-memory-worktree.adapter.ts` |
| move | `execution/infrastructure/worktree.contract.spec.ts` → `kernel/infrastructure/worktree/worktree.contract.spec.ts` |
| modify | `kernel/index.ts` — add re-exports: `WorktreePort`, `WorktreeInfo`, `WorktreeHealth`, `WorktreeError`, `CleanupReport`, `GitWorktreeAdapter`, `InMemoryWorktreeAdapter` |
| modify | `execution/index.ts` — remove worktree re-exports |
| modify | `cli/extension.ts` — update import `GitWorktreeAdapter` from `@kernel` |
| modify | `review/application/ship-slice.use-case.ts` — update import `WorktreePort` from `@kernel` |
| modify | `review/application/ship-slice.use-case.spec.ts` — update import |
| modify | `execution/application/execute-slice.use-case.ts` — update import `WorktreePort` from `@kernel` |
| modify | `execution/application/cleanup-orphaned-worktrees.use-case.ts` — update imports |

**TDD:**
- RED: Move files ⇒ old imports break (compile error)
- GREEN: Update all imports to `@kernel`, update barrel exports
- REFACTOR: Verify `kernel/infrastructure/worktree/index.ts` barrel ∃ if needed
- Run full suite ⇒ 0 failures

---

### T02: WorktreePort extension (initializeWorkspace + resolveTffDir)

**AC refs:** AC2, AC12, AC17

**Files:**

| Action | Path |
|---|---|
| modify | `kernel/ports/worktree.port.ts` — add `initializeWorkspace()` ∧ `resolveTffDir()` abstract methods |
| modify | `kernel/infrastructure/worktree/git-worktree.adapter.ts` — implement `initializeWorkspace` (fs.cp with filter) ∧ `resolveTffDir` |
| modify | `kernel/infrastructure/worktree/in-memory-worktree.adapter.ts` — implement no-op `initializeWorkspace` ∧ mock `resolveTffDir` |
| create | `kernel/infrastructure/worktree/git-worktree-workspace.spec.ts` — tests for initializeWorkspace |
| modify | `kernel/infrastructure/worktree/worktree.contract.spec.ts` — add contract tests for new methods |

**TDD:**
- RED: Test `initializeWorkspace` copies `settings.yaml`, `state.db`, `milestones/`, `PROJECT.md`, `docs/` ∧ skips `worktrees/`, `.lock`, `.tff.backup.*`, `beads-snapshot.jsonl`. Test writes fresh `branch-meta.json`. Test cleanup on copy failure (AC17).
- GREEN: Implement `initializeWorkspace` in `GitWorktreeAdapter`:
  ```typescript
  async initializeWorkspace(sliceId: string, sourceTffDir: string, branchMeta: BranchMeta): Promise<Result<void, WorktreeError>> {
    const targetTffDir = this.resolveTffDir(sliceId);
    // mkdir targetTffDir
    // fs.cp(sourceTffDir, targetTffDir, { recursive: true, filter: excludeFn })
    // Write branch-meta.json from branchMeta
    // On error: rm -rf targetTffDir, return err
  }
  ```
  Implement `resolveTffDir`: return `join(resolvedRoot, ".tff", "worktrees", sliceId, ".tff")`
- GREEN: Implement in `InMemoryWorktreeAdapter`: store branchMeta in Map, `resolveTffDir` returns `/mock/.tff/worktrees/{sliceId}/.tff/`
- REFACTOR: Extract filter function for reuse

---

### T03: GitPort.branchExists + RenameDetectionResult schema

**AC refs:** AC13, AC9

**Files:**

| Action | Path |
|---|---|
| modify | `kernel/ports/git.port.ts` — add abstract `branchExists(name: string)` |
| modify | `kernel/infrastructure/git/git-cli.adapter.ts` — implement via `git rev-parse --verify refs/heads/{name}` |
| modify | `kernel/infrastructure/git/git-cli.adapter.spec.ts` — test branchExists |
| create | `kernel/schemas/rename-detection.schemas.ts` — `RenameDetectionResultSchema` (discriminated union) |
| modify | `kernel/index.ts` — export `RenameDetectionResultSchema` |

**TDD:**
- RED: Test `branchExists` returns `true` ∀ existing branch, `false` ∀ nonexistent. Test `RenameDetectionResultSchema` parses all 4 variants.
- GREEN: Implement `branchExists` in GitCliAdapter: `git rev-parse --verify refs/heads/{name}` — exit 0 ⇒ `ok(true)`, exit 128 ⇒ `ok(false)`, other ⇒ `err(GitError)`. Create schema file.
- REFACTOR: ∅

---

### T04: Error factory additions

**AC refs:** AC5, AC6

**Files:**

| Action | Path |
|---|---|
| modify | `review/domain/errors/ship.error.ts` — add `mergeBackFailed(sliceId, cause)` |
| modify | `review/domain/errors/complete-milestone.error.ts` — add `mergeBackFailed(milestoneId, cause)` |

**TDD:**
- RED: Test `ShipError.mergeBackFailed("s1", new Error("sync failed"))` produces code `SHIP.MERGE_BACK_FAILED` ∧ correct message. Same pattern ∀ `CompleteMilestoneError.mergeBackFailed`.
- GREEN: Add factory methods following existing pattern (private constructor, static factory).
  ```typescript
  // ShipError
  static mergeBackFailed(sliceId: string, cause: unknown): ShipError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ShipError("SHIP.MERGE_BACK_FAILED",
      `State merge-back failed for slice ${sliceId}: ${msg}`, { sliceId, cause: msg });
  }

  // CompleteMilestoneError
  static mergeBackFailed(milestoneId: string, cause: unknown): CompleteMilestoneError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new CompleteMilestoneError("MILESTONE.MERGE_BACK_FAILED",
      `State merge-back failed for milestone ${milestoneId}: ${msg}`, { milestoneId, cause: msg });
  }
  ```
- REFACTOR: ∅

---

### T05: tffDir resolution split (rootTffDir + activeTffDir)

**AC refs:** AC15

**Files:**

| Action | Path |
|---|---|
| modify | `cli/extension.ts` — split `tffDir` into `rootTffDir` (always project root `.tff/`) ∧ `activeTffDir` (worktree `.tff/` when active slice has worktree, else `rootTffDir`). Global DBs (ship-records, completion-records) use `rootTffDir`. Per-slice state (`state.db`, milestone artifacts) use `activeTffDir`. |
| modify | `workflow/infrastructure/pi/workflow.extension.ts` — receive ∧ pass `activeTffDir` resolver |

**TDD:**
- RED: Test that `rootTffDir` always resolves to `join(projectRoot, ".tff")`. Test that `activeTffDir` resolves to worktree `.tff/` when active slice has worktree ∧ falls back to `rootTffDir` otherwise.
- GREEN: In `extension.ts`:
  ```typescript
  const rootTffDir = join(options.projectRoot, ".tff");
  // activeTffDir resolver: checks workflow session for active slice,
  // then worktreePort.exists(sliceId) → resolveTffDir(sliceId) || rootTffDir
  const resolveActiveTffDir = async (sliceId?: string): Promise<string> => {
    if (sliceId && await worktreeAdapter.exists(sliceId)) {
      return worktreeAdapter.resolveTffDir(sliceId);
    }
    return rootTffDir;
  };
  ```
  Ship-records DB, completion-records DB ⇒ `rootTffDir`. State DB ⇒ `activeTffDir`.
- REFACTOR: Ensure `resolveSlicePath` stub uses worktree path when available

---

### T06: StartDiscussUseCase workspace creation

**AC refs:** AC1, AC3, AC12, AC15

**Files:**

| Action | Path |
|---|---|
| modify | `workflow/use-cases/start-discuss.use-case.ts` — add `WorktreePort`, `StateSyncPort`, `MilestoneRepositoryPort` deps. Insert workspace creation (steps 1–4) before existing session logic. |
| modify | `workflow/use-cases/start-discuss.use-case.spec.ts` — add tests ∀ workspace creation, rollback on partial failure, milestone not found |

**TDD:**
- RED: Test "creates worktree + state branch + initializes workspace before session creation". Test "rolls back worktree if state branch creation fails". Test "rolls back both if initializeWorkspace fails". Test "returns error if milestone not found".
- GREEN: Extend constructor with `WorktreePort`, `StateSyncPort`, `MilestoneRepositoryPort`. In `execute()`:
  ```
  1. Validate slice exists → get milestoneId (existing)
  2. Load milestone → derive baseBranch, parentStateBranch (NEW)
  3a. WorktreePort.create(sliceId, baseBranch)
  3b. StateSyncPort.createStateBranch(sliceCodeBranch, parentStateBranch)
  3c. WorktreePort.initializeWorkspace(sliceId, tffDir, freshBranchMeta)
  4. Rollback on failure (delete created resources)
  5–8. Existing session logic
  ```
- REFACTOR: Extract rollback logic into private method

---

### T07: ShipSliceUseCase merge-back

**AC refs:** AC4, AC5

**Files:**

| Action | Path |
|---|---|
| modify | `review/application/ship-slice.use-case.ts` — add `StateSyncPort` dep. Insert merge-back between merge gate exit (line ~155) ∧ worktree delete (line ~157). Use `parsed.baseBranch` as `milestoneCodeBranch`. Derive `worktreeTffDir` via `WorktreePort.resolveTffDir(sliceId)`. Merge-back = hard fail. Worktree delete = best-effort (unchanged). Restore top-level `.tff/` = hard fail. |
| modify | `review/application/ship-slice.use-case.spec.ts` — add tests ∀ merge-back success, merge-back failure aborts ship, idempotency |

**TDD:**
- RED: Test "syncs worktree state → merges into milestone → deletes state branch → deletes worktree → restores top-level .tff/". Test "merge-back failure returns ShipError.mergeBackFailed". Test "re-running merge-back converges" (idempotency).
- GREEN: Add `StateSyncPort` to constructor. After merge gate loop, before worktree delete:
  ```typescript
  const worktreeTffDir = this.worktreePort.resolveTffDir(parsed.sliceId);
  const milestoneCodeBranch = parsed.baseBranch;

  // Merge-back (hard fail)
  const syncResult = await this.stateSyncPort.syncToStateBranch(sliceCodeBranch, worktreeTffDir);
  if (!syncResult.ok) return err(ShipError.mergeBackFailed(parsed.sliceId, syncResult.error));

  const mergeResult = await this.stateSyncPort.mergeStateBranches(sliceCodeBranch, milestoneCodeBranch, parsed.sliceId);
  if (!mergeResult.ok) return err(ShipError.mergeBackFailed(parsed.sliceId, mergeResult.error));

  const deleteStateResult = await this.stateSyncPort.deleteStateBranch(sliceCodeBranch);
  if (!deleteStateResult.ok) return err(ShipError.mergeBackFailed(parsed.sliceId, deleteStateResult.error));

  // Worktree delete (best-effort — existing behavior)
  ...

  // Restore top-level .tff/ (hard fail)
  const rootTffDir = join(this.resolvedRoot, ".tff");
  const restoreResult = await this.stateSyncPort.restoreFromStateBranch(milestoneCodeBranch, rootTffDir);
  if (!restoreResult.ok) return err(ShipError.mergeBackFailed(parsed.sliceId, restoreResult.error));
  ```
- REFACTOR: `sliceCodeBranch` derived from `WorktreeInfo.branch` ∨ convention `slice/{sliceId}`

---

### T08: CompleteMilestoneUseCase merge-back

**AC refs:** AC6, AC7

**Files:**

| Action | Path |
|---|---|
| modify | `review/application/complete-milestone.use-case.ts` — add `StateSyncPort` dep. Insert merge-back (step 5.5) between merge gate exit (line ~222) ∧ branch cleanup (line ~224). `milestoneCodeBranch = parsed.headBranch`, `defaultBranch = parsed.baseBranch` (research finding R4 — no schema change needed). |
| modify | `review/application/complete-milestone.use-case.spec.ts` — add tests ∀ merge-back success, merge-back failure |

**TDD:**
- RED: Test "syncs milestone state → merges into default branch state → deletes milestone state branch → restores .tff/". Test "merge-back failure returns CompleteMilestoneError.mergeBackFailed ∧ aborts before branch cleanup".
- GREEN: Add `StateSyncPort` to constructor. After merge gate loop (line 222), before branch cleanup (line 224):
  ```typescript
  const milestoneCodeBranch = parsed.headBranch;
  const defaultBranch = parsed.baseBranch;
  const tffDir = join(parsed.workingDirectory, ".tff");

  const syncResult = await this.stateSyncPort.syncToStateBranch(milestoneCodeBranch, tffDir);
  if (!syncResult.ok) return err(CompleteMilestoneError.mergeBackFailed(parsed.milestoneId, syncResult.error));

  const mergeResult = await this.stateSyncPort.mergeStateBranches(milestoneCodeBranch, defaultBranch, parsed.milestoneId);
  if (!mergeResult.ok) return err(CompleteMilestoneError.mergeBackFailed(parsed.milestoneId, mergeResult.error));

  const deleteResult = await this.stateSyncPort.deleteStateBranch(milestoneCodeBranch);
  if (!deleteResult.ok) return err(CompleteMilestoneError.mergeBackFailed(parsed.milestoneId, deleteResult.error));

  const restoreResult = await this.stateSyncPort.restoreFromStateBranch(defaultBranch, tffDir);
  if (!restoreResult.ok) return err(CompleteMilestoneError.mergeBackFailed(parsed.milestoneId, restoreResult.error));
  ```
- REFACTOR: ∅

---

### T09: BranchConsistencyGuard rename detection

**AC refs:** AC8, AC9

**Files:**

| Action | Path |
|---|---|
| modify | S03's `BranchConsistencyGuard` file (on `milestone/M07` branch) — add `GitPort` (branchExists) ∧ `StateBranchOpsPort` (branchExists, renameBranch, readFromStateBranch) deps. Replace simple mismatch→restore with 3-way disambiguate. |
| modify | S03's `branch-consistency-guard.spec.ts` — add tests ∀ 4 disambiguate cases |

**TDD:**
- RED: Test "old branch exists + state for current exists ⇒ switch (restore)". Test "old branch exists + no state for current ⇒ untracked (ok)". Test "old branch gone + no state for current ⇒ rename (rename state branch + update branch-meta)". Test "old branch gone + state for current + stateId match ⇒ rename". Test "old branch gone + state for current + stateId mismatch ⇒ switch (restore)".
- GREEN: Add deps to constructor. Add private `disambiguate(meta, currentBranch)`:
  ```typescript
  private async disambiguate(meta: BranchMeta, currentBranch: string): Promise<RenameDetectionResult> {
    const oldExists = await this.gitPort.branchExists(meta.codeBranch);
    const stateForCurrent = await this.stateBranchOps.branchExists(`tff-state/${currentBranch}`);

    if (oldExists.ok && oldExists.data) {
      return (stateForCurrent.ok && stateForCurrent.data)
        ? { kind: "switch" }
        : { kind: "untracked" };
    }
    // Old branch gone
    if (!stateForCurrent.ok || !stateForCurrent.data) {
      return { kind: "rename", newBranch: currentBranch };
    }
    // Ambiguous: compare stateId
    const remoteMetaBuffer = await this.stateBranchOps.readFromStateBranch(`tff-state/${currentBranch}`, "branch-meta.json");
    // parse → compare stateId
    // match ⇒ rename, mismatch ⇒ switch
  }
  ```
  In `ensure()`: replace mismatch logic with `disambiguate()` call. On `rename`: `StateBranchOpsPort.renameBranch()` + update local `branch-meta.json`. On `switch`: existing `RestoreStateUseCase.execute()`.
- REFACTOR: Extract `branch-meta.json` read/write into small helper (DRY with S03 code)

---

### T10: Wiring + integration test

**AC refs:** AC10, AC11, AC14, AC16

**Files:**

| Action | Path |
|---|---|
| modify | `cli/extension.ts` — wire `WorktreePort` from `@kernel`, pass to `StartDiscussUseCase`, `ShipSliceUseCase`, `CompleteMilestoneUseCase`. Wire `StateSyncPort` to ship ∧ complete-milestone. Wire `GitPort` + `StateBranchOpsPort` to guard. |
| modify | `workflow/infrastructure/pi/workflow.extension.ts` — pass worktreePort + stateSyncPort + milestoneRepo to StartDiscussUseCase |
| modify | `workflow/infrastructure/pi/discuss.command.ts` — ensure tffDir resolves to worktree after creation |
| test | Full test suite ⇒ 0 regressions. Verify `ExecuteSliceUseCase` still validates worktree exists (unchanged). |

**TDD:**
- RED: Integration test: discuss ⇒ worktree created ⇒ execute ⇒ reuses worktree ⇒ ship ⇒ merge-back ⇒ worktree deleted ⇒ .tff/ restored
- GREEN: Wire all deps in extension.ts. Verify barrel exports correct.
- REFACTOR: Clean up any unused imports from old worktree location

---

## Wave Summary

| Wave | Tasks | Description |
|---|---|---|
| 0 | T01, T03, T04 | Foundation: port relocation, branchExists, error factories |
| 1 | T02, T05, T09 | Extension: workspace init, tffDir split, rename detection |
| 2 | T06, T07, T08 | Use cases: discuss workspace, ship merge-back, milestone merge-back |
| 3 | T10 | Wiring + integration |

**4 waves, 10 tasks.** Wave 0 tasks are independent. Waves 1–3 build on predecessors.

# M07-S03 Verification Report

## Test Results

All 86 tests across 9 test suites pass (0 failures).

**Core M07-S03 test files (60 tests):**
- `backup-service.spec.ts` — 14 passed
- `branch-consistency-guard.spec.ts` — 9 passed
- `canonical-hash.spec.ts` — 6 passed
- `doctor-service.spec.ts` — 12 passed
- `restore-state.use-case.spec.ts` — 10 passed
- `git-hook.adapter.spec.ts` — 9 passed

**Supporting test files (26 tests):**
- `git-state-sync.adapter.spec.ts` — passed
- `state-snapshot.schemas.spec.ts` — passed
- `git-cli.adapter.spec.ts` — passed

Total execution time: ~551ms

## Acceptance Criteria

| AC | Criterion | Verdict | Evidence |
|---|---|---|---|
| AC1 | `git checkout <branch>` triggers hook and restores correct `.tff/` state | PASS | `GitHookAdapter.installPostCheckoutHook()` writes a `post-checkout` hook with TFF markers that calls the restore script when `$3=1` (branch checkout). `RestoreStateUseCase.execute(targetCodeBranch)` performs: dirty save → backup → clear → restore from `tff-state/{branch}` → update `branch-meta.json`. Test "happy path: dirty save → backup → clear → restore → update meta → clean backups" confirms full flow. `BranchConsistencyGuard.ensure()` detects mismatch and calls restore. |
| AC2 | Hook failure is non-blocking — git checkout still succeeds | PASS | The hook script wraps the restore call with `2>/dev/null || true` — any failure is silently swallowed, so git checkout always succeeds. Implementation in `init-project.use-case.ts` lines 96-100: `node -e "..." 2>/dev/null || true`. Same pattern in `extension.ts` line 401. |
| AC3 | Dirty state saved to previous state branch before restore | PASS | `RestoreStateUseCase.execute()` reads `branch-meta.json` for `previousBranch`, exports state, computes hash via `computeStateHash()`, compares to `lastSyncedHash`. On mismatch, calls `stateSync.syncToStateBranch(previousBranch, ...)`. Test "happy path" confirms `dirtySaved=true` and `syncToStateBranch` called with `"feature/previous"`. Test "skips dirty save when hash matches" confirms clean state is not synced. |
| AC4 | Crash during restore recoverable from `.tff.backup.<ts>` | PASS | `BackupService.createBackup(tffDir)` copies `.tff/` to `.tff.backup.<timestamp>` (excluding worktrees/ and .lock). `BackupService.restoreFromBackup()` clears tffDir then copies backup in. `DoctorService.checkCrashRecovery()` detects backup + missing branch-meta and auto-restores from newest backup. Tests: "copies .tff/ to a .tff.backup.<ts> directory", "restores from backup when backup exists and branch-meta missing", "restores file contents correctly". |
| AC5 | Fallback detection triggers restore when hook didn't fire (branch-meta mismatch) | PASS | `BranchConsistencyGuard.ensure()` reads `branch-meta.json`, compares `meta.codeBranch` to `gitPort.currentBranch()`. On mismatch, calls `this.tryRestore(currentBranch)`. Also handles no-meta + state-branch-exists case. Tests: "triggers restore when current branch differs from branch-meta codeBranch" and "triggers restore when no branch-meta but state branch exists for current branch". |
| AC6 | Journal replay is idempotent | PASS | `RestoreStateUseCase` uses `stateSync.restoreFromStateBranch()` which performs a full-snapshot import via `StateImporter.import()` that clears + re-inserts all DB state. Code comment at lines 90-93 explains: "StateImporter.import() clears + re-inserts" so journal replay on top of full import is a no-op. Test "calling execute() twice with same target branch both succeed (full-snapshot replace)" confirms idempotency. |
| AC7 | `tff init` installs/updates the post-checkout hook | PASS | `InitProjectUseCase.execute()` accepts optional `gitHookPort` constructor param. At step 7 (lines 93-101), if `gitHookPort` is provided, it calls `gitHookPort.installPostCheckoutHook(hookScript)`. The hook script checks `$3=1` for branch checkout. `extension.ts` line 145 passes `new GitHookAdapter(join(options.projectRoot, ".git"))` as `gitHookPort` to `registerProjectExtension`. |
| AC8 | DoctorService self-heals missing hook on any TFF command | PASS | `DoctorService.checkHook()` calls `gitHookPort.isPostCheckoutHookInstalled()` — if not installed, calls `installPostCheckoutHook()`. `BranchConsistencyGuard.ensure()` calls `this.doctor.diagnoseAndFix(tffDir)` as its first step (line 22), before any branch operations. Test "installs hook when missing" confirms installCalls=1 and "Post-checkout hook installed" in report.fixed. Test "calls diagnoseAndFix before any branch operations" confirms ordering. |
| AC9 | DoctorService detects and removes stale lock (dead PID) | PASS | `DoctorService.checkStaleLock()` reads lock file JSON, extracts `pid` and `acquiredAt`. Sends `process.kill(pid, 0)` — if it throws (dead PID), removes lock. If PID is alive but age > 5 minutes, also removes. Malformed lock files are also removed. Tests: "removes lock with dead PID" (PID 999999999), "leaves fresh lock with live PID alone" (process.pid), "removes malformed lock file". |
| AC10 | Hash-based dirty detection catches state changes even when `dirty` flag is false | PASS | `RestoreStateUseCase.execute()` at step 3 (lines 57-69): exports state, computes `computeStateHash(exportResult.data)`, compares to `meta.lastSyncedHash`. The `dirty` flag on `branch-meta.json` is NOT consulted — hash comparison is the sole dirty-detection mechanism. `computeStateHash()` uses SHA-256 over key-sorted JSON. Test "happy path" uses `lastSyncedHash: differentHash` with `dirty: false` and confirms `dirtySaved: true`. |
| AC11 | Backup cleanup keeps last 3, removes older | PASS | `BackupService.cleanOldBackups(projectRoot, 3)` reads dir entries matching `.tff.backup.*`, sorts newest-first, removes entries beyond index 3. `RestoreStateUseCase.execute()` calls `backupService.cleanOldBackups(projectRoot, 3)` at step 9. Tests: "removes oldest backups beyond keep limit" (5 backups → cleaned=2, newest 3 remain), "removes nothing when backup count is within keep limit", "removes nothing when there are exactly keep backups". |
| AC12 | Fresh clone with existing `tff-state/${currentBranch}` → first TFF command restores state + installs hook | PASS | `BranchConsistencyGuard.ensure()` handles this: no `branch-meta.json` exists (fresh clone) → checks if `tff-state/{currentBranch}` exists → if yes, calls `tryRestore()`. Doctor also installs hook if missing. Test "triggers restore when no branch-meta but state branch exists for current branch" confirms restore is triggered. Test "installs hook when missing" confirms hook installation. |
| AC13 | Crash during restore (backup exists + branch-meta missing) → doctor recovers from backup on next command | PASS | `DoctorService.checkCrashRecovery()` checks: if `branch-meta.json` missing AND `.tff.backup.*` dirs exist, picks newest backup and calls `backupService.restoreFromBackup(newestBackup, tffDir)`. `BranchConsistencyGuard.ensure()` calls `diagnoseAndFix()` first. Test "restores from backup when backup exists and branch-meta missing" confirms recovery. Test "skips recovery when branch-meta already exists" confirms guard condition. |
| AC14 | Detached HEAD → guard skips restore (no branch to map) | PASS | `BranchConsistencyGuard.ensure()` line 29: `if (currentBranch === null) return ok(undefined)` — immediately returns ok without triggering restore. Test "returns ok and skips restore when HEAD is detached (currentBranch returns null)" confirms `restoreUseCase.calls` has length 0. |
| AC15 | Guard returns `RESTORE_FAILED` → command aborts; `LOCK_CONTENTION` → command proceeds with warning | PASS | `BranchConsistencyGuard.tryRestore()` lines 58-64: if restore error code is `SYNC.LOCK_CONTENTION` or `SYNC.BRANCH_NOT_FOUND`, returns `ok(undefined)` (non-fatal, proceed). Otherwise returns `err(new SyncError("RESTORE_FAILED", ...))`. Tests: "returns err with RESTORE_FAILED when restore returns an unhandled SyncError", "returns ok when restore fails with LOCK_CONTENTION (non-fatal)", "returns ok when restore fails with BRANCH_NOT_FOUND (non-fatal)". |

## Summary

PASS: 15/15
FAIL: 0/15

## Verdict: PASS

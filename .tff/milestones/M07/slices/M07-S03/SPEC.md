# M07-S03: Restore + Post-Checkout Hook + Fallback

## Prerequisites

S03 builds on `milestone/M07` branch which carries S01 + S02 work:
- `StateBranchOpsPort` + `GitStateBranchOpsAdapter` (S01)
- `StateSyncPort` (redesigned) + `GitStateSyncAdapter` + `StateExporter` + `StateImporter` (S02)
- `AdvisoryLock`, `BranchMetaSchema`, `StateSnapshotSchema` (S02)

## Problem

`.tff/` state is local and gitignored. When a user switches branches, the state reflects the previous branch — not the current one. Without auto-restore, every branch switch silently corrupts the working context. Fresh clones have no `.tff/` at all despite state branches existing on the remote.

S02 built the core `StateSyncPort.restoreFromStateBranch()` but nothing triggers it. S03 adds the trigger mechanisms and the safety protocol around restore.

## Approach

Three-layer detection with a single restore path:

1. **Post-checkout hook** (optimization) — catches branch switches in CLI git
2. **BranchConsistencyGuard** (primary safety net) — runs before every TFF command, detects mismatch
3. **DoctorService** (self-healing) — detects and fixes structural issues (missing hook, stale locks, crash recovery from backup)

All three converge on `RestoreStateUseCase` which orchestrates the 10-step restore protocol: dirty-save → backup → clear → restore → journal replay → cleanup.

## Ports & Interfaces

### New Port: `GitHookPort`

```typescript
abstract class GitHookPort {
  abstract installPostCheckoutHook(scriptContent: string): Promise<Result<void, HookError>>;
  abstract isPostCheckoutHookInstalled(): Promise<Result<boolean, HookError>>;
  abstract uninstallPostCheckoutHook(): Promise<Result<void, HookError>>;
}
```

`HookError` codes: `HOOK_DIR_NOT_FOUND`, `PERMISSION_DENIED`, `WRITE_FAILED`.

Adapter manages a delimited section within `.git/hooks/post-checkout` — does not clobber user-defined hooks.

### Extended Port: `GitPort`

Add `currentBranch(): Promise<Result<string | null, GitError>>` — returns current branch name or `null` if HEAD is detached. Implemented via `git rev-parse --abbrev-ref HEAD` (returns `HEAD` when detached → map to `null`).

### Extended Schema: `BranchMetaSchema`

Add `lastSyncedHash: z.string().nullable().default(null)` for hash-based dirty detection.

Hash specification:
- **What is hashed:** the full `state-snapshot.json` output from `StateExporter` (S02)
- **Algorithm:** SHA-256
- **Determinism:** use `json-stable-stringify` (or equivalent canonical JSON serializer with recursive key sorting) to ensure identical state produces identical hash

### New Type: `RestoreReport`

```typescript
type RestoreReport = {
  previousBranch: string | null;
  restoredBranch: string;
  dirtySaved: boolean;
  backupPath: string;
  journalEntriesReplayed: number;
  backupsCleaned: number;
};
```

### New Type: `DiagnosticReport`

```typescript
type DiagnosticReport = {
  fixed: string[];
  warnings: string[];
};
```

## Use Cases

### `RestoreStateUseCase`

Dependencies: `StateSyncPort`, `GitPort`, `BackupService`, `AdvisoryLock`, `StateExporter` (from S02 — exports SQLite + repos to `StateSnapshot` JSON)

Locking strategy: `RestoreStateUseCase` is the sole lock holder. `StateSyncPort` methods accept an optional `lockToken` parameter — when provided, they skip their own lock acquisition. This prevents double-lock deadlock (the `AdvisoryLock` is not re-entrant).

```
execute(targetCodeBranch: string): Result<RestoreReport, RestoreError>

1. Acquire .tff/.lock → lockToken
2. Read branch-meta.json → previousBranch
3. Dirty check: export current state → hash → compare to lastSyncedHash
   - If dirty → StateSyncPort.syncToStateBranch(previousBranch, tffDir, { lockToken })
4. Backup .tff/ → .tff.backup.<ISO-timestamp> (exclude worktrees/, backups)
5. Clear .tff/ (preserve worktrees/, .lock, backups)
6. StateSyncPort.restoreFromStateBranch(targetCodeBranch, tffDir, { lockToken })
7. Journal catch-up: read journal from state branch, apply entries with seq > lastJournalOffset to local SQLite
   (This is state-sync journal replay — NOT execution replay. It brings the DB forward from the snapshot baseline.)
8. Update branch-meta.json (codeBranch, stateBranch, lastSyncedAt, lastSyncedHash)
9. Clean old backups (keep last 3, sorted by timestamp)
10. Release lock
```

Error handling:
- Lock contention → return `LOCK_CONTENTION`, don't block
- Target state branch doesn't exist → return `BRANCH_NOT_FOUND`
- Dirty save fails → proceed with restore (backup exists as safety net)
- Restore fails → leave backup intact, return `RESTORE_FAILED`

## Infrastructure Adapters

### `GitHookAdapter` (implements `GitHookPort`)

- Reads `.git/hooks/post-checkout` (creates file if absent)
- Manages delimited section between markers:
  ```bash
  # --- TFF-PI BEGIN (do not edit) ---
  if [ "$3" = "1" ]; then
    node -e "require('./node_modules/.tff-restore.js')" 2>/dev/null || true
  fi
  # --- TFF-PI END ---
  ```
- `$3 = "1"` = branch checkout (vs file checkout)
- `|| true` = non-blocking (git ignores exit code anyway, but belt + suspenders)
- `installPostCheckoutHook`: insert/replace delimited section, `chmod +x`
- `isPostCheckoutHookInstalled`: check for BEGIN marker
- `uninstallPostCheckoutHook`: remove delimited section, leave rest intact
- Idempotent — calling install twice produces same result

### Minimal CLI restore entry point

S03 ships a lightweight restore script (`.tff-restore.js` or equivalent) that the hook invokes directly via `node`. This avoids the `npx` cold-start problem and removes the forward dependency on S05's `/tff:sync` command. The script:
1. Reads `branch-meta.json`
2. Resolves current branch
3. If mismatch → calls `RestoreStateUseCase.execute()` via programmatic API
4. Exits 0 regardless (non-blocking)

### `BackupService`

Pure filesystem utility (not behind a port — no swappable implementations needed):
- `createBackup(tffDir)` → copies `.tff/` to `.tff.backup.<ISO-timestamp>`, excludes `worktrees/` and existing backups
- `cleanOldBackups(projectRoot, keep=3)` → list `.tff.backup.*`, sort by timestamp, remove oldest beyond limit
- `clearTffDir(tffDir)` → remove contents except `worktrees/`, `.lock`, and the directory itself

### `DoctorService`

Dependencies: `GitHookPort`, `StateBranchOpsPort`, `GitPort`, `BackupService`, filesystem

```
diagnoseAndFix(tffDir): DiagnosticReport

Checks (in order):
1. Crash recovery: .tff.backup.* exists AND branch-meta.json missing
   → restore from most recent backup (not from state branch — backup is fresher)
   → report fixed
2. Post-checkout hook missing → install → report fixed
3. branch-meta.json missing but tff-state/${currentBranch} exists → flag for restore
4. .gitignore missing `.tff/` or `.tff.backup.*` entries → add → report fixed
5. Stale .lock file (dead PID) → remove → report fixed
```

Lock file format: JSON `{ "pid": number, "createdAt": string }`. Stale detection: `process.kill(pid, 0)` — if throws `ESRCH`, PID is dead → remove lock. On non-Unix platforms where PID check is unreliable, fall back to age-based expiry (lock older than 5 minutes = stale).

Non-throwing. Reports what it fixed and what needs attention.

### `BranchConsistencyGuard`

Dependencies: `DoctorService`, `GitPort`, `RestoreStateUseCase`, `StateBranchOpsPort`, filesystem

`GuardError` codes: `RESTORE_FAILED` (abort command with message), `LOCK_CONTENTION` (warn and proceed with existing state).

```
ensure(tffDir): Result<void, GuardError>

1. DoctorService.diagnoseAndFix(tffDir)          // self-heal first
2. currentBranch = GitPort.currentBranch()
3. If currentBranch is null (detached HEAD) → ok (no branch to map)
4. Read branch-meta.json → meta
5. If meta exists AND meta.codeBranch === currentBranch → ok
6. If meta exists AND mismatch → restore from tff-state/${currentBranch}
   - RESTORE_FAILED → abort (return error, command must not run on wrong state)
   - LOCK_CONTENTION → warn and proceed (another restore in progress)
   - BRANCH_NOT_FOUND → ok (no state branch for this code branch)
7. If meta missing → check if tff-state/${currentBranch} exists
   - Yes → restore (hook already installed by doctor)
   - No → ok (untracked branch, no state to restore)
```

Guard resolves target state branch from current HEAD — no hardcoded default branch.

## Wiring & Integration

### Command entry point

```
TFF command invoked
  → BranchConsistencyGuard.ensure(tffDir)
    → DoctorService.diagnoseAndFix()
    → branch-meta vs HEAD check → RestoreStateUseCase if needed
  → actual command use case executes
```

### Hook → restore script → UseCase chain

```
.git/hooks/post-checkout ($3 = "1")
  → node .tff-restore.js
    → RestoreStateUseCase.execute()
```

Hook bypasses the guard — it's already reacting to the branch switch.

### Composition in existing use cases

- `InitProjectUseCase` — add `GitHookPort.installPostCheckoutHook()` at end
- No other use cases modified (hook also installed by DoctorService on any TFF command)

### Dependency graph

```
DoctorService
  ├── GitHookPort
  ├── GitPort                  (currentBranch for check #3)
  ├── StateBranchOpsPort       (branchExists for check #3)
  ├── BackupService            (crash recovery for check #1)
  └── FileSystem               (lock file, .gitignore)

BranchConsistencyGuard
  ├── DoctorService
  ├── GitPort                  (currentBranch)
  ├── RestoreStateUseCase
  └── StateBranchOpsPort       (branchExists only — narrow coupling)

RestoreStateUseCase
  ├── StateSyncPort            (sync-out dirty, restore-from-branch — with lockToken)
  ├── GitPort
  ├── AdvisoryLock
  ├── BackupService
  └── StateExporter            (for dirty hash computation)
```

## Acceptance Criteria

| AC | Criterion |
|---|---|
| AC1 | `git checkout <branch>` triggers hook and restores correct `.tff/` state |
| AC2 | Hook failure is non-blocking — git checkout still succeeds |
| AC3 | Dirty state saved to previous state branch before restore |
| AC4 | Crash during restore recoverable from `.tff.backup.<ts>` |
| AC5 | Fallback detection triggers restore when hook didn't fire (branch-meta mismatch) |
| AC6 | Journal replay is idempotent |
| AC7 | `tff init` installs/updates the post-checkout hook |
| AC8 | DoctorService self-heals missing hook on any TFF command |
| AC9 | DoctorService detects and removes stale lock (dead PID) |
| AC10 | Hash-based dirty detection catches state changes even when `dirty` flag is false |
| AC11 | Backup cleanup keeps last 3, removes older |
| AC12 | Fresh clone with existing `tff-state/${currentBranch}` → first TFF command restores state + installs hook |
| AC13 | Crash during restore (backup exists + branch-meta missing) → doctor recovers from backup on next command |
| AC14 | Detached HEAD → guard skips restore (no branch to map) |
| AC15 | Guard returns `RESTORE_FAILED` → command aborts; `LOCK_CONTENTION` → command proceeds with warning |

## Non-Goals

- State reconstruction from parent branch (S05 scope)
- Worktree lifecycle changes (S04 scope)
- Remote push of state branches
- Incremental/delta sync (full snapshot per sync)
- `/tff:sync` manual command (S05 scope)

## Risks

| Risk | Mitigation |
|---|---|
| Hook script startup latency | Direct `node` invocation (no `npx`). `|| true` ensures non-blocking. Guard is the primary safety net. |
| Hook not portable across git clients (GUIs, IDE integrations) | Guard is the primary mechanism. Hook is optimization for CLI users. |
| Backup disk usage accumulates | Keep-3 cleanup runs on every restore |
| Doctor adds latency to every command | Checks are cheap (stat calls + one git branch check). Cache result for session if needed. |
| Concurrent TFF commands race on restore | AdvisoryLock serializes. Second command gets `LOCK_CONTENTION` → proceeds with warning. |

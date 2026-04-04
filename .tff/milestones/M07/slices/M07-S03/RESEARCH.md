# M07-S03 Research: Restore + Post-Checkout Hook + Fallback

## Dependency Analysis

### S02 Merge Status

S02 (`slice/M07-S02`) is **not yet merged** into `milestone/M07`. S03 branch must fork from `slice/M07-S02` or wait for S02 merge. All S03 code depends on S02 artifacts.

### S02 Foundation — Verified Interfaces

**StateSyncPort** (`src/kernel/ports/state-sync.port.ts`)
- `syncToStateBranch(codeBranch, tffDir): Result<void, SyncError>`
- `restoreFromStateBranch(codeBranch, tffDir): Result<SyncReport, SyncError>`
- `mergeStateBranches(child, parent, sliceId): Result<void, SyncError>`
- `createStateBranch(codeBranch, parentStateBranch): Result<void, SyncError>`
- `deleteStateBranch(codeBranch): Result<void, SyncError>`

**GitStateSyncAdapter** (`src/kernel/infrastructure/state-branch/git-state-sync.adapter.ts`)
- Both `syncToStateBranch` and `restoreFromStateBranch` acquire `.tff/.lock` internally
- S03 must add optional `lockToken` parameter to prevent double-lock deadlock (AdvisoryLock is non-reentrant)

**AdvisoryLock** (`src/kernel/infrastructure/state-branch/advisory-lock.ts`)
- `acquire(lockPath, timeoutMs?): Result<LockRelease, SyncError>`
- Non-reentrant: same process acquiring twice → LOCK_CONTENTION
- Uses `writeFileSync` with `flag: 'wx'` for atomic creation
- Stale detection via `process.kill(pid, 0)`

**StateExporter** (`src/kernel/services/state-exporter.ts`)
- `export(): Result<StateSnapshot, SyncError>`
- Traverses all 6 repos: project, milestone, slice, task, shipRecord, completionRecord
- Returns full `StateSnapshot` — this is what gets hashed for dirty detection

**BranchMetaSchema** (`src/kernel/infrastructure/state-branch/state-snapshot.schemas.ts`)
- Fields: version, stateId, codeBranch, stateBranch, parentStateBranch, lastSyncedAt, lastJournalOffset, dirty
- S03 adds: `lastSyncedHash: z.string().nullable().default(null)`

**GitPort** (`src/kernel/ports/git.port.ts`)
- No `currentBranch()` method exists — S03 adds it
- `GitCliAdapter` (`src/kernel/infrastructure/git-cli.adapter.ts`) — all methods use `runGit()` helper with clean env

**StateBranchOpsPort** (`src/kernel/ports/state-branch-ops.port.ts`)
- `branchExists(branchName): Result<boolean, GitError>` — needed by Guard + Doctor
- `readFromStateBranch(stateBranch, path): Result<string | null, GitError>`

**InitProjectUseCase** (`src/hexagons/project/use-cases/init-project.use-case.ts`)
- Constructor: projectRepo, projectFs, mergeSettings, eventBus, dateProvider
- S03 adds `GitHookPort` to constructor — inserts hook install after step 6

## Key Technical Findings

### 1. Lock Pass-Through — Breaking Interface Change

`StateSyncPort.syncToStateBranch` and `restoreFromStateBranch` both acquire `.tff/.lock` internally. `RestoreStateUseCase` needs to hold the lock across dirty-save → backup → clear → restore. Without lockToken pass-through, the use case would deadlock.

**Approach**: Add optional `options?: { lockToken?: LockRelease }` parameter to `syncToStateBranch` and `restoreFromStateBranch` on the port. When provided, adapter skips `acquire()` and doesn't release. This is a port-level change — both port and adapter update together.

### 2. Hash-Based Dirty Detection

SPEC requires SHA-256 of canonical JSON from `StateExporter.export()`.

- No `json-stable-stringify` in project dependencies
- **Options**: (a) add `json-stable-stringify` dep, (b) implement simple recursive key sort
- **Recommendation**: Option (b) — avoids new dependency for a ~10-line utility. `JSON.stringify(sortKeys(obj))` with recursive key sorting is deterministic for the same input.
- Node `crypto.createHash('sha256')` is built-in — no dependency needed for hashing.

### 3. Entry Point for Hook Script

The `.tff-restore.js` (or equivalent) must instantiate `RestoreStateUseCase` without the full extension wiring. It needs:
- `better-sqlite3` for DB access (already a project dependency)
- `GitCliAdapter` for branch operations
- `GitStateBranchOpsAdapter`, `GitStateSyncAdapter`, `StateExporter`, `StateImporter`, `AdvisoryLock`
- All 6 SQLite repositories

**Challenge**: The restore script is invoked by git hook outside the plugin context. It must locate the project root (`.git` discovery) and bootstrap the minimal DI stack.

**Approach**: Ship a single `.tff-restore.cjs` file (or bundled equivalent) at project root that:
1. Resolves project root from `__dirname` or `git rev-parse --show-toplevel`
2. Opens `state.db`, `ship-records.db`, `completion-records.db`
3. Constructs minimal dependency graph (no event bus, no agent registry)
4. Calls `RestoreStateUseCase.execute()`
5. Exits 0 regardless

### 4. BranchConsistencyGuard Wiring

The guard must run before every TFF command. Current extension wiring (`src/cli/extension.ts`) registers commands via `registerWorkflowExtension`, `registerProjectExtension`, etc.

**Integration point**: The guard should be instantiated in `createTffExtension()` and passed to a command middleware or invoked at the top of each command handler. The simplest approach: expose a `guard.ensure(tffDir)` call at the start of the extension setup (after DB init, before command execution).

### 5. Doctor Self-Heal Checks

DoctorService checks (from SPEC):
1. **Crash recovery**: `.tff.backup.*` exists AND `branch-meta.json` missing → restore from backup
2. **Hook missing**: → install via GitHookPort
3. **branch-meta missing + state branch exists**: → flag for restore
4. **`.gitignore` missing entries**: → add `.tff/` and `.tff.backup.*`
5. **Stale lock**: → check PID, remove if dead

Check #4 (`.gitignore`) is interesting — the existing `InitProjectUseCase` doesn't manage `.gitignore`. DoctorService adds this as a self-heal.

Check #5 (stale lock) — `AdvisoryLock` already handles stale detection during `acquire()`. Doctor adds proactive cleanup at startup.

### 6. Backup Exclusions

`BackupService.createBackup()` copies `.tff/` → `.tff.backup.<ts>` excluding:
- `worktrees/` (large, branch-specific)
- Existing `.tff.backup.*` (prevent recursive backup)
- `.lock` file (transient)

The `.tff/` directory on S02 contains: `PROJECT.md`, `STATE.md`, `settings.yaml`, `state.db`, `ship-records.db`, `completion-records.db`, `milestones/`, `skills/`, `observations/`, `branch-meta.json`, potentially `metrics.jsonl`.

Backup must include SQLite `.db` files. SQLite supports hot backup via `.backup()` API (`better-sqlite3` exposes this). However, for simplicity and since we hold the lock during backup, a filesystem copy is safe.

### 7. Journal Replay Idempotency

The SPEC states journal replay must be idempotent (AC6). The current journal format uses `.jsonl` with sequential entries.

**Approach**: Each journal entry has a `seq` number. `BranchMeta.lastJournalOffset` tracks the last replayed entry. On restore, only replay entries with `seq > lastJournalOffset`. This makes replay idempotent — replaying the same entries a second time has no effect because the offset gate prevents re-application.

### 8. Existing Test Patterns

S02 tests use:
- **Vitest** (describe/it/expect)
- **Temp directories** (`os.tmpdir()` + unique suffix)
- **Contract specs** (shared behavior across implementations)
- **No mocking framework** — manual stubs implementing port interfaces
- **Inline fixtures** — construct test data in test files

S03 should follow same patterns. Key test categories:
- `backup-service.spec.ts` — filesystem operations with temp dirs
- `doctor-service.spec.ts` — each check in isolation with controlled state
- `branch-consistency-guard.spec.ts` — mismatch scenarios
- `restore-state.use-case.spec.ts` — full 10-step protocol
- `git-hook.adapter.spec.ts` — hook file manipulation

## Architecture Review

| Aspect | Status | Finding |
|---|---|---|
| Layer dependency | pass | All new components follow domain ← app ← infra direction. GitHookPort in kernel/ports, adapter in kernel/infrastructure. |
| Module boundaries | pass | RestoreStateUseCase, BackupService, DoctorService, BranchConsistencyGuard have single clear responsibilities. |
| Port coverage | pass | External deps (git hooks, filesystem backup) accessed through ports or services. BackupService is pure utility — no port needed per SPEC. |
| Cross-cutting concerns | watch | BranchConsistencyGuard integration needs careful wiring — must intercept all commands without tight coupling. |

## Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| S02 not yet merged — S03 must fork from S02 branch | Low | Fork `slice/M07-S03` from `slice/M07-S02`. Both merge into `milestone/M07` independently. |
| lockToken pass-through changes StateSyncPort interface | Medium | Additive change (optional param). Existing callers unaffected. Both port + adapter updated atomically. |
| `.tff-restore.js` bootstrap complexity | Medium | Keep minimal — only instantiate what RestoreStateUseCase needs. No event bus, no agent registry, no settings merge. |
| Guard wiring across all commands | Medium | Single guard instance in extension, called at setup. Commands don't need to know about it. |
| SQLite concurrent access during hook restore | Low | AdvisoryLock serializes. Hook runs in separate process but lock prevents races. |

## File Inventory — New & Modified

### New Files
- `src/kernel/ports/git-hook.port.ts` — GitHookPort abstract class
- `src/kernel/infrastructure/git-hook/git-hook.adapter.ts` — GitHookAdapter
- `src/kernel/infrastructure/git-hook/git-hook.adapter.spec.ts`
- `src/kernel/services/backup-service.ts` — BackupService
- `src/kernel/services/backup-service.spec.ts`
- `src/kernel/services/doctor-service.ts` — DoctorService
- `src/kernel/services/doctor-service.spec.ts`
- `src/kernel/services/branch-consistency-guard.ts` — BranchConsistencyGuard
- `src/kernel/services/branch-consistency-guard.spec.ts`
- `src/kernel/use-cases/restore-state.use-case.ts` — RestoreStateUseCase
- `src/kernel/use-cases/restore-state.use-case.spec.ts`
- `.tff-restore.cjs` (or `src/kernel/infrastructure/restore-entry.ts`) — hook entry point

### Modified Files
- `src/kernel/ports/git.port.ts` — add `currentBranch()`
- `src/kernel/infrastructure/git-cli.adapter.ts` — implement `currentBranch()`
- `src/kernel/ports/state-sync.port.ts` — add optional lockToken to sync/restore
- `src/kernel/infrastructure/state-branch/git-state-sync.adapter.ts` — honor lockToken
- `src/kernel/infrastructure/state-branch/state-snapshot.schemas.ts` — add `lastSyncedHash` to BranchMetaSchema
- `src/hexagons/project/use-cases/init-project.use-case.ts` — add GitHookPort, call installHook
- `src/cli/extension.ts` — wire new components
- `.gitignore` — ensure `.tff.backup.*` excluded

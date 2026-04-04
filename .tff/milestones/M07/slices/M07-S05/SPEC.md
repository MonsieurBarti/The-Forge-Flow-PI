# Spec — M07-S05: State Reconstruction + /tff:sync

## Problem

State recovery split across `BranchConsistencyGuard` (mismatch detection + 3-way disambiguate) ∧ `DoctorService` (crash recovery, hook install, stale locks, gitignore). Neither handles "fresh clone with no `.tff/`" scenario. No `/tff:sync` command exists. Recovery logic hard to extend ∧ test — spread across two services with overlapping concerns.

## Context

S01-S04 built full state sync infrastructure: `StateSyncPort`, `StateBranchOpsPort`, `RestoreFromStateBranchUseCase`, `BackupService`, `AdvisoryLock`, snapshot merge, branch-meta tracking. This slice consolidates recovery into strategy-based architecture ∧ adds reconstruction + sync capabilities.

**Dependencies:** `StateSyncPort`, `StateBranchOpsPort`, `RestoreFromStateBranchUseCase`, `BackupService`, `AdvisoryLock` — all stable from S02-S04.

## Approach

**Strategy Pattern with Port.** New `StateRecoveryPort` in kernel defining recovery contract. `ReconstructStateUseCase` (via `StateRecoveryAdapter`) detects scenario ∧ delegates to strategy implementations. `BranchConsistencyGuard` ∧ `DoctorService` retired — logic absorbed into strategies ∧ `HealthCheckService`.

## Architecture

### StateRecoveryPort (domain port)

```typescript
// src/kernel/ports/state-recovery.port.ts
abstract class StateRecoveryPort {
  abstract detect(tffDir: string): Promise<Result<RecoveryScenario, SyncError>>;
  abstract recover(scenario: RecoveryScenario, tffDir: string): Promise<Result<RecoveryReport, SyncError>>;
}
```

### Value Objects

```typescript
// RecoveryScenario
type RecoveryType = 'crash' | 'mismatch' | 'rename' | 'fresh-clone' | 'untracked' | 'healthy';

interface RecoveryScenario {
  type: RecoveryType;
  currentBranch: string | null;       // null on detached HEAD → always healthy
  branchMeta: BranchMeta | null;
  backupPaths: string[];
  stateBranchExists: boolean;
  parentStateBranch: string | null;
}

// RecoveryReport
interface RecoveryReport {
  type: RecoveryType;
  action: 'restored' | 'renamed' | 'created-fresh' | 'skipped' | 'none';
  source: string;
  filesRestored: number;
  warnings: string[];
}
```

### Strategy Interface + Implementations

```typescript
// src/kernel/ports/recovery-strategy.ts (domain-level interface, co-located with port)
interface RecoveryStrategy {
  readonly handles: RecoveryType;
  execute(scenario: RecoveryScenario, tffDir: string): Promise<Result<RecoveryReport, SyncError>>;
}
```

**CrashRecoveryStrategy** (`crash`)
- Trigger: `branch-meta.json` missing + `.tff.backup.*` exists
- Flow: sort backups by timestamp → if state branch exists, compare backup timestamp vs state branch `lastSyncedAt` → prefer whichever is newer → restore via `BackupService.restoreFromBackup()` or `RestoreFromStateBranchUseCase` → validate `branch-meta.json` → report
- Fallback: backup restore fails → degrade to `fresh-clone` strategy

**MismatchRecoveryStrategy** (`mismatch`)
- Trigger: `branch-meta.json.codeBranch` ≠ HEAD + old branch exists + state branch exists for current
- Flow: lock → save dirty state to previous branch → backup `.tff/` → restore from `tff-state/<currentBranch>` via `RestoreFromStateBranchUseCase` → update branch-meta → cleanup

**RenameRecoveryStrategy** (`rename`)
- Trigger: old branch gone + no state for current, OR old branch gone + state exists with matching `stateId`
- Flow: `StateBranchOpsPort.renameBranch(old, new)` → update `branch-meta.json` fields → report

**FreshCloneStrategy** (`fresh-clone`)
- Trigger: no `.tff/` directory, OR `.tff/` exists but `branch-meta.json` missing ∧ no backups
- Fallback chain:
  1. Check for `.tff.backup.*` files → if found, restore newest (same as CrashRecovery — covers case where `.tff/` dir was deleted but backups survive)
  2. `tff-state/<currentBranch>` exists → restore from it
  3. Discover parent via naming convention → restore from parent:
     - Branch matches `^slice/(M\d+)-S\d+$` → extract capture group 1 → parent = `tff-state/milestone/<M##>`
     - Branch matches `^milestone/(M\d+)$` → parent = `tff-state/main`
     - Branch = `main` → no parent (fall through)
     - Any other pattern → no parent (fall through to scaffold)
  4. Create fresh project scaffold (minimal `.tff/` with empty `PROJECT.md`, `settings.yaml` defaults, `branch-meta.json`)
- After restore: run `HealthCheckService` (hook, gitignore)

### Orchestrator Adapter

```typescript
// src/kernel/infrastructure/state-recovery/state-recovery.adapter.ts
class StateRecoveryAdapter implements StateRecoveryPort {
  constructor(private strategies: Map<RecoveryType, RecoveryStrategy>) {}

  async detect(tffDir): Result<RecoveryScenario> {
    // 0. Detached HEAD → return healthy (skip all recovery — no branch to map)
    // 1. .tff/ missing → fresh-clone
    // 2. branch-meta.json missing + backups exist → crash
    // 3. branch-meta.json missing + no backups + .tff/ exists → fresh-clone (empty/corrupt .tff/)
    // 4. codeBranch ≠ HEAD → disambiguate: mismatch | rename | untracked
    // 5. All checks pass → healthy
  }

  async recover(scenario, tffDir): Result<RecoveryReport> {
    if (scenario.type === 'healthy' || scenario.type === 'untracked') return skip;
    return this.strategies.get(scenario.type).execute(scenario, tffDir);
  }
}
```

### /tff:sync — ForceSyncUseCase

```typescript
// src/kernel/services/force-sync.use-case.ts
class ForceSyncUseCase {
  async push(tffDir: string): Result<SyncReport, SyncError>
  // lock → full snapshot export → syncToStateBranch → update branch-meta (lastSyncedAt, lastSyncedHash) → unlock

  async pull(tffDir: string): Result<RestoreReport, SyncError>
  // lock → backup → restoreFromStateBranch → update branch-meta → cleanup → unlock
}
```

- Default: `push` — force-push local state to state branch (full snapshot)
- `--pull` flag: force-restore from state branch, overwriting local `.tff/`
- Both acquire advisory lock, both update `branch-meta.json`
- Registered as `/tff:sync` skill command

### StateGuard (auto-trigger middleware)

```typescript
// src/kernel/services/state-guard.ts
class StateGuard {
  constructor(
    private recoveryPort: StateRecoveryPort,
    private healthCheck: HealthCheckService,
  ) {}

  async ensure(tffDir: string): Result<void, SyncError> {
    // 1. Health checks (hook, gitignore, stale locks)
    // 2. Detect recovery scenario
    // 3. healthy → ok | recovery needed → recover → log | fail → error
  }
}
```

- Replaces `BranchConsistencyGuard.ensure()` at all existing call sites
- **Wiring pattern:** `extension.ts` creates `StateGuard` instance ∧ exposes a `withGuard(handler)` wrapper function. Each skill command handler is wrapped: `withGuard(async (ctx) => { ... })`. The wrapper calls `StateGuard.ensure()` before delegating to the handler. Detached HEAD → skip (return early, no recovery).
- Non-blocking for `untracked` scenario
- Logs: `[tff] State recovered: <type> → <action> (source: <source>)`

### HealthCheckService (slimmed DoctorService)

```typescript
// src/kernel/services/health-check.service.ts
class HealthCheckService {
  async ensurePostCheckoutHook(): Result<void, HookError>
  async ensureGitignore(): Result<void, Error>
  async cleanStaleLocks(tffDir: string): Result<number, Error>
}
```

Non-recovery maintenance concerns extracted from `DoctorService`.

**Stale lock logic** (ported from `DoctorService`): check PID liveness via `process.kill(pid, 0)`; if PID dead OR lock age > 5 minutes → remove `.tff/.lock`.

### File Structure

```
src/kernel/
  ports/
    state-recovery.port.ts              (NEW)
    recovery-strategy.ts                (NEW — domain interface)
  schemas/
    recovery.schemas.ts                 (NEW — RecoveryType, RecoveryScenario, RecoveryReport)
  infrastructure/
    state-recovery/                     (NEW directory)
      state-recovery.adapter.ts
      crash-recovery.strategy.ts
      mismatch-recovery.strategy.ts
      fresh-clone.strategy.ts
      rename-recovery.strategy.ts
  services/
    force-sync.use-case.ts              (NEW)
    state-guard.ts                      (NEW)
    health-check.service.ts             (NEW)
    branch-consistency-guard.ts         (DELETED)
    doctor-service.ts                   (DELETED)
```

### Retired Services

- `BranchConsistencyGuard` → detection logic into `StateRecoveryAdapter`, mismatch/rename logic into strategies
- `DoctorService` → crash recovery into `CrashRecoveryStrategy`, non-recovery into `HealthCheckService`
- `restore-entry.ts` → update to reference `StateGuard` instead of `BranchConsistencyGuard`

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC1 | Losing `.tff/` entirely + running any tff command reconstructs state from `tff-state/*` (branch-meta, state.db, settings, artifacts all restored) |
| AC2 | Fresh clone fallback chain: own branch → parent (discovered via naming convention) → fresh scaffold. Non-conventional branch names (`feature/foo`) fall through to scaffold |
| AC3 | `.tff/` NEVER appears in code branch commits (existing invariant I1 — regression guard) |
| AC4 | `/tff:sync` (push, default) forces synchronous state branch update before command returns. Lock contention → wait or error, never silent skip |
| AC5 | `/tff:sync --pull` backs up local `.tff/` then force-restores from state branch. Missing state branch → error with diagnostic |
| AC6 | Crash-during-restore (missing `branch-meta.json` + `.tff.backup.*` exists) recoverable — prefers newest source (backup timestamp vs state branch `lastSyncedAt`) |
| AC7 | If `.tff.backup.*` restore fails, recovery degrades to fresh-clone strategy (CrashRecovery → FreshClone fallback) |
| AC8 | `BranchConsistencyGuard` + `DoctorService` + `restore-entry.ts` references fully retired — no source files, no production-code references |
| AC9 | StateGuard wired via `withGuard(handler)` wrapper at every handler registered in `extension.ts` (net-new wiring — guard was previously constructed but never called) |
| AC10 | Recovery is idempotent — second `StateGuard.ensure()` invocation detects `healthy` ∧ performs zero filesystem writes |

## Non-Goals

- Incremental journal sync (offset-based push, journal replay on restore) — deferred due to idempotency risks (no dedup key on journal entries). Full-snapshot sync satisfies R06. Revisit when `correlationId` is made required on journal entries.
- Remote sync (Dolt) — deferred
- Multi-device conflict resolution — out of scope for single-user PI
- Post-checkout hook build pipeline (`node_modules/.tff-restore.js` generation) — S03 placeholder, not R06 scope
- Partial `.tff/` recovery (e.g., directory exists but corrupted) — routed to fresh-clone via detection step 3

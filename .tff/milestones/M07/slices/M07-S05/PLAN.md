# M07-S05: State Reconstruction + /tff:sync — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Replace BranchConsistencyGuard + DoctorService with strategy-based StateRecoveryPort. Add ForceSyncUseCase (/tff:sync push+pull). Wire StateGuard at every command entry point.

**Architecture:** Strategy Pattern with Port — `StateRecoveryPort.detect()` → `RecoveryScenario` → strategy `.execute()` → `RecoveryReport`. Four strategies: crash, mismatch, rename, fresh-clone. HealthCheckService handles non-recovery maintenance.

**Tech Stack:** TypeScript, Vitest, Zod, hexagonal architecture (ports/adapters), Result<T,E> pattern.

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/kernel/schemas/recovery.schemas.ts` | RecoveryType, RecoveryScenario, RecoveryReport Zod schemas |
| `src/kernel/ports/state-recovery.port.ts` | StateRecoveryPort abstract class |
| `src/kernel/ports/recovery-strategy.ts` | RecoveryStrategy interface |
| `src/kernel/services/health-check.service.ts` | Hook install, gitignore, stale lock maintenance |
| `src/kernel/infrastructure/state-recovery/crash-recovery.strategy.ts` | Backup-based crash recovery |
| `src/kernel/infrastructure/state-recovery/rename-recovery.strategy.ts` | State branch rename on code branch rename |
| `src/kernel/infrastructure/state-recovery/mismatch-recovery.strategy.ts` | Branch mismatch → restore from state branch |
| `src/kernel/infrastructure/state-recovery/fresh-clone.strategy.ts` | No .tff/ → fallback chain: own → parent → scaffold |
| `src/kernel/infrastructure/state-recovery/state-recovery.adapter.ts` | Detection pipeline + strategy dispatch |
| `src/kernel/services/force-sync.use-case.ts` | /tff:sync push (full snapshot) + pull (force restore) |
| `src/kernel/services/state-guard.ts` | Auto-trigger middleware for every tff command |

### Modified Files
| File | Change |
|---|---|
| `src/kernel/ports/index.ts` | Export StateRecoveryPort, RecoveryStrategy |
| `src/kernel/index.ts` | Export recovery schemas |
| `src/cli/extension.ts` | Replace DoctorService+BranchConsistencyGuard → StateGuard + withGuard wrapper |
| `src/kernel/infrastructure/restore-entry.ts` | Update comment: StateGuard replaces BranchConsistencyGuard |

### Deleted Files
| File | Reason |
|---|---|
| `src/kernel/services/branch-consistency-guard.ts` | Logic absorbed into strategies + adapter |
| `src/kernel/services/branch-consistency-guard.spec.ts` | Replaced by strategy + adapter tests |
| `src/kernel/services/doctor-service.ts` | Split into strategies + HealthCheckService |
| `src/kernel/services/doctor-service.spec.ts` | Replaced by HealthCheckService + strategy tests |

---

## Wave 0 — Foundation Types (parallel)

### T01: Recovery Schemas
**Files:** Create `src/kernel/schemas/recovery.schemas.ts`, Create `src/kernel/schemas/recovery.schemas.spec.ts`
**Traces to:** AC1, AC2, AC6, AC10

- [ ] Write failing test: validate RecoveryScenarioSchema accepts valid scenario, rejects invalid. Test RecoveryReportSchema. Test RecoveryType union covers all 6 variants.
  ```
  npx vitest run src/kernel/schemas/recovery.schemas.spec.ts → FAIL
  ```
- [ ] Implement schemas:
  - `RecoveryType` = `'crash' | 'mismatch' | 'rename' | 'fresh-clone' | 'untracked' | 'healthy'`
  - `RecoveryScenarioSchema`: type, currentBranch (string | null), branchMeta (BranchMetaSchema | null), backupPaths (string[]), stateBranchExists (boolean), parentStateBranch (string | null)
  - `RecoveryReportSchema`: type, action ('restored' | 'renamed' | 'created-fresh' | 'skipped' | 'none'), source (string), filesRestored (number), warnings (string[])
  ```
  npx vitest run src/kernel/schemas/recovery.schemas.spec.ts → PASS
  ```
- [ ] Commit: `feat(S05/T01): add recovery schemas`

### T02: StateRecoveryPort + RecoveryStrategy Interface
**Files:** Create `src/kernel/ports/state-recovery.port.ts`, Create `src/kernel/ports/recovery-strategy.ts`, Modify `src/kernel/ports/index.ts`
**Traces to:** AC1, AC10

- [ ] Create StateRecoveryPort abstract class:
  ```typescript
  abstract class StateRecoveryPort {
    abstract detect(tffDir: string): Promise<Result<RecoveryScenario, SyncError>>;
    abstract recover(scenario: RecoveryScenario, tffDir: string): Promise<Result<RecoveryReport, SyncError>>;
  }
  ```
- [ ] Create RecoveryStrategy interface:
  ```typescript
  interface RecoveryStrategy {
    readonly handles: RecoveryType;
    execute(scenario: RecoveryScenario, tffDir: string): Promise<Result<RecoveryReport, SyncError>>;
  }
  ```
- [ ] Update `src/kernel/ports/index.ts` — add exports
- [ ] No test needed (abstract class + interface only — tested via implementations)
- [ ] Commit: `feat(S05/T02): add StateRecoveryPort and RecoveryStrategy interface`

### T03: HealthCheckService
**Files:** Create `src/kernel/services/health-check.service.ts`, Create `src/kernel/services/health-check.service.spec.ts`
**Traces to:** AC8

- [ ] Write failing tests — port from `doctor-service.spec.ts` check 2 (hook), check 3 (orphaned state), check 4 (gitignore), check 5 (stale lock). 7 test cases:
  1. Hook missing → install
  2. Hook installed → skip
  3. Orphaned state → warning
  4. No orphaned state → no warning
  5. Gitignore missing entries → append
  6. Gitignore complete → skip
  7. Stale lock (dead PID) → remove
  ```
  npx vitest run src/kernel/services/health-check.service.spec.ts → FAIL
  ```
- [ ] Implement HealthCheckService:
  ```typescript
  interface HealthCheckDeps {
    gitHookPort: GitHookPort;
    stateBranchOps: StateBranchOpsPort;
    gitPort: GitPort;
    hookScriptContent: string;
    projectRoot: string;
  }
  class HealthCheckService {
    async ensurePostCheckoutHook(): Result<void, HookError>
    async ensureGitignore(): Result<void, Error>
    async cleanStaleLocks(tffDir: string): Result<number, Error>
    async checkOrphanedState(tffDir: string): Result<string[], Error>  // returns warnings
    async runAll(tffDir: string): Result<{ fixed: string[]; warnings: string[] }, Error>
  }
  ```
  - Port stale lock logic verbatim from DoctorService lines 109-133: PID check via `process.kill(pid, 0)`, age > 5min threshold, malformed JSON handling
  - Port hook check from DoctorService lines 63-73
  - Port gitignore check from DoctorService lines 91-107
  - Port orphaned state from DoctorService lines 75-89
  ```
  npx vitest run src/kernel/services/health-check.service.spec.ts → PASS
  ```
- [ ] Commit: `feat(S05/T03): add HealthCheckService extracted from DoctorService`

---

## Wave 1 — Recovery Strategies (depends on Wave 0)

### T04: CrashRecoveryStrategy
**Files:** Create `src/kernel/infrastructure/state-recovery/crash-recovery.strategy.ts`, Create `src/kernel/infrastructure/state-recovery/crash-recovery.strategy.spec.ts`
**Traces to:** AC6, AC7

- [ ] Write failing tests — partially ported from `doctor-service.spec.ts` crash recovery; **timestamp comparison vs state branch is NEW logic** (not in original DoctorService). Cases:
  1. Backup exists + no state branch → restore newest backup
  2. Backup exists + state branch exists + backup newer → restore backup (NEW — requires comparing backup timestamp vs state branch lastSyncedAt)
  3. Backup exists + state branch exists + state branch newer → restore from state branch (NEW)
  4. Backup restore fails → degrade to fresh-clone action (return report with action='created-fresh')
  5. Multiple backups → sort by timestamp, use newest
  ```
  npx vitest run src/kernel/infrastructure/state-recovery/crash-recovery.strategy.spec.ts → FAIL
  ```
- [ ] Implement CrashRecoveryStrategy:
  - `handles: 'crash'`
  - Dependencies: `BackupService`, `StateBranchOpsPort`, `RestoreStateUseCase`
  - Flow: sort backups by timestamp → compare vs state branch lastSyncedAt → prefer newest source → restore → validate branch-meta → report
  - Fallback: backup restore fails → return report requesting fresh-clone degradation
  ```
  npx vitest run src/kernel/infrastructure/state-recovery/crash-recovery.strategy.spec.ts → PASS
  ```
- [ ] Commit: `feat(S05/T04): add CrashRecoveryStrategy`

### T05: RenameRecoveryStrategy
**Files:** Create `src/kernel/infrastructure/state-recovery/rename-recovery.strategy.ts`, Create `src/kernel/infrastructure/state-recovery/rename-recovery.strategy.spec.ts`
**Traces to:** AC1, AC10

- [ ] Write failing tests — port from `branch-consistency-guard.spec.ts` rename cases:
  1. Rename state branch + update branch-meta.json
  2. Rename fails → return err(SyncError)
  ```
  npx vitest run src/kernel/infrastructure/state-recovery/rename-recovery.strategy.spec.ts → FAIL
  ```
- [ ] Implement RenameRecoveryStrategy:
  - `handles: 'rename'`
  - Dependencies: `StateBranchOpsPort`
  - Flow: port `handleRename()` from BranchConsistencyGuard lines 109-132
  ```
  npx vitest run src/kernel/infrastructure/state-recovery/rename-recovery.strategy.spec.ts → PASS
  ```
- [ ] Commit: `feat(S05/T05): add RenameRecoveryStrategy`

### T06: MismatchRecoveryStrategy
**Files:** Create `src/kernel/infrastructure/state-recovery/mismatch-recovery.strategy.ts`, Create `src/kernel/infrastructure/state-recovery/mismatch-recovery.strategy.spec.ts`
**Traces to:** AC1, AC10

- [ ] Write failing tests — port from `branch-consistency-guard.spec.ts` switch cases:
  1. Restore from state branch via RestoreStateUseCase
  2. LOCK_CONTENTION → non-fatal (return skipped)
  3. BRANCH_NOT_FOUND → non-fatal (return skipped)
  4. Other error → return err(SyncError)
  ```
  npx vitest run src/kernel/infrastructure/state-recovery/mismatch-recovery.strategy.spec.ts → FAIL
  ```
- [ ] Implement MismatchRecoveryStrategy:
  - `handles: 'mismatch'`
  - Dependencies: `RestoreStateUseCase`
  - Flow: port `tryRestore()` from BranchConsistencyGuard lines 134-145
  ```
  npx vitest run src/kernel/infrastructure/state-recovery/mismatch-recovery.strategy.spec.ts → PASS
  ```
- [ ] Commit: `feat(S05/T06): add MismatchRecoveryStrategy`

### T07: FreshCloneStrategy
**Files:** Create `src/kernel/infrastructure/state-recovery/fresh-clone.strategy.ts`, Create `src/kernel/infrastructure/state-recovery/fresh-clone.strategy.spec.ts`
**Traces to:** AC1, AC2, AC7

- [ ] Write failing tests — NEW logic, no existing code to port:
  1. Backup files exist → restore newest backup (covers crash where .tff/ dir removed but backups survive)
  2. No backup + state branch exists for current → restore from state branch
  3. No backup + no state branch + parent discoverable (`slice/M07-S05` → `tff-state/milestone/M07`) → restore from parent
  4. `milestone/M07` → parent = `tff-state/main`
  5. `main` → no parent → scaffold
  6. Non-conventional branch name (`feature/foo`) → scaffold
  7. Scaffold creates minimal .tff/ with PROJECT.md, settings.yaml, branch-meta.json
  ```
  npx vitest run src/kernel/infrastructure/state-recovery/fresh-clone.strategy.spec.ts → FAIL
  ```
- [ ] Implement FreshCloneStrategy:
  - `handles: 'fresh-clone'`
  - Dependencies: `BackupService`, `StateBranchOpsPort`, `RestoreStateUseCase`, `HealthCheckService`
  - Fallback chain (matches spec order): backup → own state branch → parent state branch → scaffold
  - Parent discovery regexes:
    - `^slice/(M\d+)-S\d+$` → `tff-state/milestone/$1`
    - `^milestone/(M\d+)$` → `tff-state/main`
    - `main` → no parent
  - After restore: `healthCheck.runAll(tffDir)`
  ```
  npx vitest run src/kernel/infrastructure/state-recovery/fresh-clone.strategy.spec.ts → PASS
  ```
- [ ] Commit: `feat(S05/T07): add FreshCloneStrategy with fallback chain`

---

## Wave 2 — Orchestrator + Use Cases (depends on Wave 1)

### T08: StateRecoveryAdapter
**Files:** Create `src/kernel/infrastructure/state-recovery/state-recovery.adapter.ts`, Create `src/kernel/infrastructure/state-recovery/state-recovery.adapter.spec.ts`
**Traces to:** AC1, AC6, AC10

- [ ] Write failing tests:
  1. `.tff/` missing → detects `fresh-clone`
  2. Detached HEAD → detects `healthy`
  3. branch-meta missing + backups exist → detects `crash`
  4. branch-meta missing + no backups + .tff/ exists → detects `fresh-clone`
  5. codeBranch ≠ HEAD + old branch exists + state for current exists → detects `mismatch`
  6. codeBranch ≠ HEAD + old branch gone + no state for current → detects `rename`
  7. codeBranch ≠ HEAD + old branch gone + state exists for current + stateId matches → detects `rename` (ambiguous case resolved via stateId comparison)
  8. codeBranch ≠ HEAD + old branch gone + state exists for current + stateId mismatches → detects `mismatch` (switch)
  9. codeBranch ≠ HEAD + old branch exists + no state → detects `untracked`
  10. codeBranch === HEAD → detects `healthy`
  11. `recover()` with healthy → returns skipped
  12. `recover()` with crash → delegates to CrashRecoveryStrategy
  13. `recover()` with untracked → returns skipped
  ```
  npx vitest run src/kernel/infrastructure/state-recovery/state-recovery.adapter.spec.ts → FAIL
  ```
- [ ] Implement StateRecoveryAdapter:
  - Constructor: `strategies: Map<RecoveryType, RecoveryStrategy>`, `gitPort: GitPort`, `stateBranchOps: StateBranchOpsPort`, `projectRoot: string`
  - `detect()`: 6-step priority chain from spec (step 0-5)
  - `recover()`: lookup strategy → delegate or skip for healthy/untracked
  - Port disambiguate logic from BranchConsistencyGuard lines 65-107
  ```
  npx vitest run src/kernel/infrastructure/state-recovery/state-recovery.adapter.spec.ts → PASS
  ```
- [ ] Commit: `feat(S05/T08): add StateRecoveryAdapter with detection pipeline`

### T09: ForceSyncUseCase
**Files:** Create `src/kernel/services/force-sync.use-case.ts`, Create `src/kernel/services/force-sync.use-case.spec.ts`
**Traces to:** AC4, AC5

- [ ] Write failing tests:
  1. `push()` — acquires lock → calls `stateSync.syncToStateBranch()` → updates branch-meta → releases lock
  2. `push()` — lock contention → error
  3. `pull()` — acquires lock → backup → `restoreUseCase.execute(currentBranch)` → releases lock
  4. `pull()` — missing state branch → error with diagnostic
  5. `push()` — synchronous (returns after sync complete)
  ```
  npx vitest run src/kernel/services/force-sync.use-case.spec.ts → FAIL
  ```
- [ ] Implement ForceSyncUseCase:
  - Dependencies: `StateSyncPort`, `RestoreStateUseCase`, `AdvisoryLock`, `GitPort`, `tffDir`, `projectRoot`
  - `push()`: lock → `stateSync.syncToStateBranch(currentBranch, tffDir)` → release
  - `pull()`: lock → `restoreUseCase.execute(currentBranch)` → release
  ```
  npx vitest run src/kernel/services/force-sync.use-case.spec.ts → PASS
  ```
- [ ] Commit: `feat(S05/T09): add ForceSyncUseCase for /tff:sync push+pull`

---

## Wave 3 — Guard + Wiring (depends on Wave 2)

### T10: StateGuard
**Files:** Create `src/kernel/services/state-guard.ts`, Create `src/kernel/services/state-guard.spec.ts`
**Traces to:** AC9, AC10

- [ ] Write failing tests:
  1. `ensure()` — healthy scenario → calls healthCheck.runAll + recoveryPort.detect → returns ok, zero fs writes
  2. `ensure()` — crash scenario → calls recover → logs action
  3. `ensure()` — recovery fails → returns error
  4. Idempotency: call `ensure()` twice → second returns healthy, zero writes
  5. Health check runs before detection
  ```
  npx vitest run src/kernel/services/state-guard.spec.ts → FAIL
  ```
- [ ] Implement StateGuard:
  - Dependencies: `StateRecoveryPort`, `HealthCheckService`
  - `ensure(tffDir)`: healthCheck.runAll() → recoveryPort.detect() → if not healthy: recoveryPort.recover() → log
  ```
  npx vitest run src/kernel/services/state-guard.spec.ts → PASS
  ```
- [ ] Commit: `feat(S05/T10): add StateGuard middleware`

### T11: Extension.ts Wiring + StateGuard at Entry Points
**Files:** Modify `src/cli/extension.ts`, Modify `src/cli/extension.spec.ts`, Modify 4 command registration files + their deps interfaces
**Traces to:** AC4, AC5, AC8, AC9

- [ ] Write failing test: verify extension constructs StateGuard (not BranchConsistencyGuard/DoctorService)
  ```
  npx vitest run src/cli/extension.spec.ts → FAIL
  ```
- [ ] Replace extension.ts lines 406-427:
  - Remove `DoctorService` + `BranchConsistencyGuard` construction
  - Add: `HealthCheckService`, 4 strategy instances, `StateRecoveryAdapter`, `StateGuard`
  - Add: `ForceSyncUseCase` wired with `gitStateSyncAdapter`, `restoreUseCase`, `AdvisoryLock`, `gitPort`
- [ ] Create `withGuard` helper in extension.ts:
  ```typescript
  const withGuard = async (tffDir: string) => {
    const result = await stateGuard.ensure(tffDir);
    if (!result.ok) throw new Error(`State guard failed: ${result.error.message}`);
  };
  ```
- [ ] Pass `withGuard` + `forceSyncUseCase` to these 4 registration functions (enumerate all entry points):
  1. `registerProjectExtension(api, { ..., withGuard })` — `src/hexagons/project/infrastructure/pi/project.extension.ts`
  2. `registerWorkflowExtension(api, { ..., withGuard })` — `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`
     - Also passes to `registerDiscussCommand`, `registerResearchCommand`, `registerPlanCommand`
  3. `registerOverlayExtension(api, { ... })` — `src/cli/overlay.extension.ts` (UI-only commands — guard optional)
  4. Register `/tff:sync` command in extension.ts directly:
     ```typescript
     api.registerCommand("tff:sync", {
       description: "Force-push or force-pull state to/from state branch",
       handler: async (args: string) => {
         await withGuard(rootTffDir);
         const isPull = args.trim() === "--pull";
         const result = isPull
           ? await forceSyncUseCase.pull(rootTffDir)
           : await forceSyncUseCase.push(rootTffDir);
         // report result to user
       },
     });
     ```
- [ ] In each command handler receiving `withGuard`: call `await deps.withGuard(tffDir)` at top of handler before any tff-tools operations
  ```
  npx vitest run src/cli/extension.spec.ts → PASS
  ```
- [ ] Commit: `feat(S05/T11): wire StateGuard + /tff:sync command at all entry points`

### T12: Update Restore Entry + Barrel Exports
**Files:** Modify `src/kernel/infrastructure/restore-entry.ts`, Modify `src/kernel/ports/index.ts`, Modify `src/kernel/index.ts`
**Traces to:** AC8

- [ ] Update `restore-entry.ts` comment: `StateGuard` replaces `BranchConsistencyGuard`
- [ ] Verify barrel exports include new types (from T02)
- [ ] Commit: `docs(S05/T12): update restore-entry references and barrel exports`

---

## Wave 4 — Retirement + Validation (depends on Wave 3)

### T13: Delete Retired Services
**Files:** Delete `src/kernel/services/branch-consistency-guard.ts`, Delete `src/kernel/services/branch-consistency-guard.spec.ts`, Delete `src/kernel/services/doctor-service.ts`, Delete `src/kernel/services/doctor-service.spec.ts`
**Traces to:** AC8

- [ ] Delete all 4 files
- [ ] Remove any barrel exports referencing deleted files
- [ ] Verify: `grep -r "BranchConsistencyGuard\|DoctorService" src/ --include="*.ts"` → zero matches in production code
  ```
  npx vitest run → ALL PASS (no broken imports)
  ```
- [ ] Commit: `refactor(S05/T13): retire BranchConsistencyGuard and DoctorService`

### T14: Full Test Suite + Integration Verification
**Files:** None (validation only)
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10

- [ ] Run full test suite: `npx vitest run` → ALL PASS
- [ ] Run typecheck: `npx tsc --noEmit` → clean
- [ ] Verify AC3: `git diff --cached --name-only | grep ".tff/"` → 0 results (existing .gitignore covers this)
- [ ] Verify AC8: `grep -rn "BranchConsistencyGuard\|DoctorService" src/ --include="*.ts"` → 0 results
- [ ] Verify AC9: grep for `withGuard` in all command registration files → present in project.extension.ts, workflow.extension.ts, discuss.command.ts, research.command.ts, plan.command.ts, extension.ts (sync command)
- [ ] Commit: `chore(S05/T14): verify full test suite and acceptance criteria`

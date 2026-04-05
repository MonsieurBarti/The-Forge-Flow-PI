# Verification — M07-S05: State Reconstruction + /tff:sync

## Test Summary

63 new tests across 9 test files, all passing. Full suite: 1952 pass, 0 fail.

## Acceptance Criteria Verdicts

| AC | Verdict | Evidence |
|---|---|---|
| AC1: Losing `.tff/` reconstructs from `tff-state/*` | **PASS** | `StateRecoveryAdapter.spec.ts` test "detects 'fresh-clone' when .tff/ directory does not exist" + `FreshCloneStrategy.spec.ts` TC2 "restores from state branch when no backup and state branch exists" — 13 adapter tests + 8 fresh-clone tests |
| AC2: Fresh clone fallback chain (own → parent → scaffold) | **PASS** | `FreshCloneStrategy.spec.ts` TC1-TC7: backup → state branch → parent discovery (`slice/M07-S05` → `tff-state/milestone/M07`, `milestone/M07` → `tff-state/main`) → scaffold. TC6 verifies `feature/foo` falls through to scaffold |
| AC3: `.tff/` never in code branch commits | **PASS** | `.gitignore` enforced by `HealthCheckService.ensureGitignore()` (test: "appends missing entries to .gitignore"). Existing invariant I1 preserved |
| AC4: `/tff:sync` push forces synchronous state branch update | **PASS** | `ForceSyncUseCase.spec.ts` "calls syncToStateBranch with current branch and returns ok" + "propagates error when syncToStateBranch fails". Command registered: `src/cli/extension.ts:446` |
| AC5: `/tff:sync --pull` backs up + force-restores | **PASS** | `ForceSyncUseCase.spec.ts` "calls restoreUseCase.execute with current branch" + "returns error when HEAD is detached". RestoreStateUseCase (from S03) handles backup + restore internally |
| AC6: Crash recovery prefers newest source | **PASS** | `CrashRecoveryStrategy.spec.ts` "prefers backup when backup timestamp is newer" + "prefers state branch when its lastSyncedAt is newer" — timestamp comparison implemented and tested |
| AC7: Backup restore fails → degrades to fresh-clone | **PASS** | `CrashRecoveryStrategy.spec.ts` "returns action='created-fresh' when backup restore throws" — degradation signal for orchestrator |
| AC8: Retired services — no files, no references | **PASS** | `grep -rn "BranchConsistencyGuard\|DoctorService" src/ --include="*.ts"` → 0 results. Files deleted: `branch-consistency-guard.ts`, `branch-consistency-guard.spec.ts`, `doctor-service.ts`, `doctor-service.spec.ts`. `restore-entry.ts` updated to reference StateGuard |
| AC9: StateGuard wired at entry points | **PASS** | `src/cli/extension.ts:441` constructs StateGuard. `extension.ts:449` calls `stateGuard.ensure(rootTffDir)` in `/tff:sync` handler. Guard was `void guard` (never called) — now actively invoked |
| AC10: Recovery idempotent | **PASS** | `StateGuard.spec.ts` "idempotency — first call recovers crash, second call detects healthy → zero recovery calls on second invocation" |

## Overall Verdict: **PASS** (10/10 AC met)

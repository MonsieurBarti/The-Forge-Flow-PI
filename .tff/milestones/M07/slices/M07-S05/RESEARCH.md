# Research — M07-S05: State Reconstruction + /tff:sync

## 1. Retired Services — Logic to Port

### BranchConsistencyGuard (`src/kernel/services/branch-consistency-guard.ts`)

**Constructor deps:** `DoctorService`, `GitPort`, `RestoreStateUseCase`, `StateBranchOpsPort`

**`ensure()` flow (7-step pipeline):**
1. Call `doctor.diagnoseAndFix(tffDir)` first
2. Get current branch via `gitPort.currentBranch()` — if error, return `ok(undefined)` (tolerant)
3. Detached HEAD (null) → return `ok(undefined)`
4. If branch-meta exists:
   - Parse via `BranchMetaSchema.parse()`
   - `meta.codeBranch === currentBranch` → ok (in sync)
   - Mismatch → `disambiguate()` then switch: match/untracked → ok, rename → `handleRename()`, switch → `tryRestore()`
5. If no branch-meta:
   - State branch exists for current → `tryRestore(currentBranch)`
   - No state branch → ok (untracked)

**`disambiguate()` — 3-way detection:**
- Queries: does old branch exist? Does state branch exist for current?
- Old exists + state for current → `switch`
- Old exists + no state → `untracked`
- Old gone + no state for current → `rename`
- Old gone + state exists → compare `stateId` from remote branch-meta:
  - Match → `rename`
  - Mismatch or parse failure → `switch`

**`handleRename()`:** `stateBranchOps.renameBranch(old, new)` → update `branch-meta.json` (codeBranch + stateBranch fields) via `writeFileSync`

**`tryRestore()`:** `restoreUseCase.execute(targetBranch)` — non-fatal on `LOCK_CONTENTION` ∧ `BRANCH_NOT_FOUND` (return ok). Other errors → `RESTORE_FAILED`.

**Tests:** 11 cases in `.spec.ts` — stubs for all 4 deps, covers all disambiguate branches, error classification, doctor-before-branch ordering.

### DoctorService (`src/kernel/services/doctor-service.ts`)

**Constructor deps:** `GitHookPort`, `StateBranchOpsPort`, `GitPort`, `BackupService`, `hookScriptContent`, `projectRoot`

**5 checks (all run, order matters):**

| Check | Category | Logic | Action |
|---|---|---|---|
| crashRecovery | RECOVERY | meta missing → list `.tff.backup.*` → sort desc → restore newest | `backupService.restoreFromBackup()` → fixed[] |
| hook | MAINTENANCE | `gitHookPort.isPostCheckoutHookInstalled()` → if missing, install | `gitHookPort.installPostCheckoutHook()` → fixed[] |
| orphanedState | MAINTENANCE | meta missing + state branch exists → warn | warnings[] |
| gitignore | MAINTENANCE | check `.tff/` ∧ `.tff.backup.*` entries → append if missing | append to .gitignore → fixed[] |
| staleLock | RECOVERY | read `.tff/.lock` → parse JSON → `process.kill(pid, 0)` → stale if dead OR age > 5min | `unlinkSync` → fixed[] |

**Tests:** 9 cases in `.spec.ts` — per-check isolation, stub deps, helper functions `makeTmpDir()`, `buildTffDir()`, `writeBackup()`, `writeBranchMeta()`.

### restore-entry.ts (`src/kernel/infrastructure/restore-entry.ts`)

Placeholder function `restoreOnCheckout()` — empty body, comment references `BranchConsistencyGuard` as primary safety net. Must update reference to `StateGuard`.

### Split Guidance

**→ Recovery strategies:** crash recovery, stale lock removal, disambiguate + rename + restore orchestration
**→ HealthCheckService:** hook install, orphaned state warning, gitignore maintenance

## 2. Extension.ts Wiring

### Current Guard Construction (lines 406-427)

```typescript
const doctorService = new DoctorService({...});
const guard = new BranchConsistencyGuard(doctorService, gitPort, restoreUseCase, stateBranchOps);
void guard; // Available for command-time invocation
```

Guard is **constructed but never called** — `void guard` is dead code. `withGuard` is net-new wiring.

### Handler Registration Pattern

**API:** `api.registerCommand(name, { description, handler })`
**Signature:** `handler: async (args: string, ctx?: ExtensionCommandContext) => Promise<void>`

### Command Handlers (8 total across 4 files)

| File | Command | Location |
|---|---|---|
| `src/cli/overlay.extension.ts` | `tff:dashboard`, `tff:workflow-view`, `tff:execution-monitor` | UI overlay commands |
| `src/hexagons/project/infrastructure/pi/project.extension.ts` | `tff:new` | Project init |
| `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts` | `tff:status` | Status command |
| `src/hexagons/workflow/infrastructure/pi/discuss.command.ts` | `tff:discuss` | Discuss phase |
| `src/hexagons/workflow/infrastructure/pi/research.command.ts` | `tff:research` | Research phase |
| `src/hexagons/workflow/infrastructure/pi/plan.command.ts` | `tff:plan` | Plan phase |

### withGuard Pattern

```typescript
function withGuard(handler: (args: string) => Promise<void>): (args: string) => Promise<void> {
  return async (args: string) => {
    const result = await stateGuard.ensure(rootTffDir);
    if (!result.ok) { api.sendUserMessage(`Guard failed: ${result.error.message}`); return; }
    return handler(args);
  };
}
```

**Challenge:** Commands are registered in separate files that don't share the guard instance. Options:
- A) Pass guard to each command registration function
- B) Export `withGuard` from extension.ts ∧ import in command files
- C) Centralize all registrations in extension.ts (most invasive)

**Recommendation:** Option A — minimal coupling, each command file receives guard via constructor/factory params.

### Files Referencing Retired Services

Only `src/cli/extension.ts` imports both. No other production files. Test files (`.spec.ts`) also import — will be deleted with source files.

## 3. State Sync Composition

### ForceSyncUseCase Dependencies

```typescript
interface ForceSyncUseCaseDeps {
  stateSync: StateSyncPort;          // GitStateSyncAdapter
  restoreUseCase: RestoreStateUseCase;
  advisoryLock: AdvisoryLock;
  stateExporter: StateExporter;
  backupService: BackupService;
  tffDir: string;
  projectRoot: string;
}
```

### Push Flow (reuses existing)

`GitStateSyncAdapter.syncToStateBranch()` already does:
1. Acquire lock (or accept lockToken)
2. `stateExporter.export()` → full snapshot
3. Read/update branch-meta (lastSyncedAt, dirty=false)
4. Collect artifacts from `milestones/` dir
5. Normalize journal → single `journal.jsonl`
6. Include `metrics.jsonl`
7. `stateBranchOps.syncToStateBranch(stateBranch, files)` — atomic commit via temp worktree
8. Release lock

**ForceSyncUseCase.push() is essentially a thin wrapper** around `stateSync.syncToStateBranch()` with explicit lock + hash update.

### Pull Flow (reuses existing)

`RestoreStateUseCase.execute()` already does the full restore:
1. Lock → dirty check → sync dirty to previous → backup → clear → restore → update meta → cleanup → unlock

**ForceSyncUseCase.pull() is essentially `restoreUseCase.execute(currentBranch)`** — restore from own state branch. May need to skip dirty-save step (force overwrite semantics).

### Key: Lock Protocol

`AdvisoryLock.acquire()` returns `() => void` release function. Both sync/restore accept `{ lockToken }` to skip internal lock acquisition when caller already holds the lock.

### Canonical Hash

`computeStateHash(snapshot)`: recursive key sort → `JSON.stringify` → SHA256 hex. Used for dirty detection (`lastSyncedHash` comparison).

## 4. Test Infrastructure

### Framework

Vitest v3.0.0 — `npm test` (vitest run), `npm run test:watch`, pattern `src/**/*.spec.ts` (221 files).

### Test Strategies per Layer

| Layer | Strategy | Pattern |
|---|---|---|
| Ports/schemas | Unit | Zod parse assertions |
| Adapters (unit) | Unit | `vi.mock()` for child_process, custom stubs for ports |
| Adapters (integration) | Integration | Real git in tmpdir, 30s timeout |
| Use cases | Unit | Stub classes extending port interfaces |
| Services | File system | Real tmpdir, real fs operations |

### Reusable Helpers

- `makeTmpDir()` — isolated tmpdir
- `buildTffDir(root)` — creates `.tff/` with worktrees/, state.db
- `makeSnapshot(seed)` — controllable snapshot timestamps
- `createMockBranchOps()` — Map-based in-memory StateBranchOpsPort
- `mockSuccess(stdout?)` / `mockFailure(stderr, code)` — git command simulation
- `StubStateSyncPort` — tracks calls array, settable results
- `StubAdvisoryLock` — failure simulation, release tracking

### Builder Pattern (Domain Objects)

TaskBuilder, SliceBuilder, MilestoneBuilder, ProjectBuilder — `.withId().withSliceId().buildProps()`

### In-Memory Adapters

Full set in hexagon infrastructure dirs — used for domain-level integration tests.

### Key Test Patterns for New Code

1. **Strategy tests:** One spec per strategy, stub port deps, test trigger conditions + flow
2. **Adapter tests:** StateRecoveryAdapter tested with mock strategies (verify routing)
3. **StateGuard tests:** Stub RecoveryPort + HealthCheckService, test ensure() pipeline
4. **ForceSyncUseCase tests:** Stub StateSyncPort + RestoreUseCase, verify push/pull flows
5. **withGuard tests:** Verify wrapper calls ensure() before handler, blocks on failure

## 5. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Commands registered in separate files — guard sharing | Pass guard via factory params (Option A) |
| FreshClone on non-standard branches may scaffold unnecessarily | AC2 explicitly documents: non-conventional → scaffold |
| CrashRecovery prefers backup over newer state branch | Spec updated: compare timestamps, prefer newest |
| Stale lock PID check cross-user (`EPERM` vs `ESRCH`) | Pre-existing in DoctorService — port as-is, document |
| 8 handlers to wrap — risk of missing one | Verify via grep in AC8 test |

## 6. Implementation Notes

- `ForceSyncUseCase.push()` = thin wrapper around `stateSync.syncToStateBranch(currentBranch, tffDir)`
- `ForceSyncUseCase.pull()` = `restoreUseCase.execute(currentBranch)` with force-overwrite (skip dirty save)
- `StateRecoveryAdapter.detect()` needs: `fs.existsSync`, `gitPort.currentBranch()`, `stateBranchOps.branchExists()`, `readdirSync` for backups
- `HealthCheckService` can reuse `GitHookPort` ∧ `BackupService` deps from DoctorService
- Stale lock logic: port verbatim from DoctorService lines 109-133

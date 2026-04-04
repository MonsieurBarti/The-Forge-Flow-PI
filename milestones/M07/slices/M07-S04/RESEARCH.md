# Research — M07-S04: Worktree Isolation + Rename + Merge-Back

## Questions Investigated

1. **WorktreePort relocation scope** — What files move, what imports break, what barrels need updating?
2. **StartDiscussUseCase extension surface** — Current deps, flow, test patterns — how much grows?
3. **ShipSliceUseCase merge-back insertion** — Exact line-level insertion point, how to derive milestoneCodeBranch.
4. **CompleteMilestoneUseCase extension** — Exact insertion point, schema extension, error factory gap.
5. **BranchConsistencyGuard availability** — Does S03 code exist on current branch?
6. **tffDir resolution mechanism** — Current hardcoded path, what needs to become dynamic.
7. **S01–S03 deliverable availability** — Which ports/adapters exist on `main` vs `milestone/M07`?

## Codebase Findings

### Existing Patterns

**WorktreePort & co-located files (6 files to relocate):**

| File | Current path | Target |
|---|---|---|
| `worktree.port.ts` | `execution/domain/ports/` | `kernel/ports/` |
| `worktree.schemas.ts` | `execution/domain/` | `kernel/ports/` or `kernel/schemas/` |
| `worktree.error.ts` | `execution/domain/errors/` | `kernel/errors/` |
| `git-worktree.adapter.ts` | `execution/infrastructure/` | `kernel/infrastructure/worktree/` |
| `in-memory-worktree.adapter.ts` | `execution/infrastructure/` | `kernel/infrastructure/worktree/` |
| `worktree.contract.spec.ts` | `execution/infrastructure/` | `kernel/infrastructure/worktree/` |

`WorktreeError` extends `BaseDomainError` from kernel — no circular dependency risk.

**Import locations to update (5 files):**
- `src/cli/extension.ts` line 6 — imports `GitWorktreeAdapter`
- `src/hexagons/review/application/ship-slice.use-case.ts` line 1 — imports `WorktreePort`
- `src/hexagons/review/application/ship-slice.use-case.spec.ts` line 2 — imports `WorktreePort`
- `src/hexagons/execution/application/execute-slice.use-case.ts` line 39 — imports `WorktreePort`
- `src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.ts` lines 2,4 — imports `WorktreeError`, `WorktreePort`, `CleanupReport`

**Barrel update:** `execution/index.ts` re-exports `WorktreePort`, `WorktreeError`, `WorktreeInfo`, `WorktreeHealth`, `CleanupReport`, `GitWorktreeAdapter`, `InMemoryWorktreeAdapter`. These move to `kernel/index.ts`.

### Relevant Files

**StartDiscussUseCase** (`workflow/use-cases/start-discuss.use-case.ts`):
- 5 constructor deps: `SliceRepositoryPort`, `WorkflowSessionRepositoryPort`, `EventBusPort`, `DateProviderPort`, `AutonomyModeProvider`
- `execute()` is 60 lines: validate slice → find/create session → assign slice → trigger "start" → save → publish events
- Input: `{ sliceId, milestoneId }` — milestoneId already available
- Test file co-located, uses `sliceRepo.seed()`, `sessionRepo.seed()`, fixed date provider
- Wired via `workflow.extension.ts` (not directly in `cli/extension.ts`)

**ShipSliceUseCase** (`review/application/ship-slice.use-case.ts`):
- 13 constructor deps (including `worktreePort`)
- `ShipRequestSchema` has `baseBranch` field — this IS the milestone branch (e.g. `milestone/M05`)
- Worktree delete at lines 157–164 (Step 5), after merge gate exit at line 155
- **Insertion point:** Between line 155 and line 157
- `baseBranch` can directly serve as `milestoneCodeBranch` — no extra lookup needed
- `ShipError` factories: `prerequisiteFailed`, `prCreationFailed`, `cleanupFailed`, `mergeDeclined`, `contextResolutionFailed` — needs new `mergeBackFailed(sliceId, cause)`

**CompleteMilestoneUseCase** (`review/application/complete-milestone.use-case.ts`):
- 12 constructor deps
- `CompleteMilestoneRequestSchema` has: `milestoneId`, `milestoneLabel`, `milestoneTitle`, `headBranch`, `baseBranch`, `workingDirectory`, `maxFixCycles`
- **Insertion point:** Between line 222 (merge gate loop exit) and line 224 (Step 6: branch cleanup)
- `baseBranch` is the default branch (e.g. "main") — the merge target
- `headBranch` is the milestone branch (e.g. "milestone/M07") — the source of state
- `CompleteMilestoneError` factories: `openSlicesRemaining`, `invalidMilestoneStatus`, `auditFailed`, `prCreationFailed`, `mergeDeclined`, `cleanupFailed` — needs new `mergeBackFailed(milestoneId, cause)`
- Test uses `StubMilestoneQueryPort`, `StubAuditPort` with fluent builder pattern

**tffDir resolution** (`cli/extension.ts`):
- Currently: `const tffDir = join(options.projectRoot, ".tff")` (line 286) — hardcoded
- `options.projectRoot` passed into `createTffExtension()` as param
- `resolveSlicePath` is a stub returning error — not yet functional
- `GitWorktreeAdapter` constructed at line 283: `new GitWorktreeAdapter(gitPort, options.projectRoot)`
- Worktree paths derived internally by adapter: `.tff/worktrees/{sliceId}`

### Dependencies

**S01–S03 deliverables NOT on `main`:**
- `StateBranchOpsPort` — does not exist
- `GitStateBranchOpsAdapter` — does not exist
- `GitStateSyncAdapter` — does not exist
- `BranchMetaSchema` — does not exist
- `BranchConsistencyGuard` — does not exist
- `DoctorService` — does not exist
- `RestoreStateUseCase` — does not exist
- `BackupService` — does not exist

**StateSyncPort on `main` is the OLD interface:**
```typescript
abstract push(): Promise<Result<void, SyncError>>;
abstract pull(): Promise<Result<SyncReport, SyncError>>;
abstract markDirty(): Promise<void>;
```
S02 replaces this with the branch-aware 5-method interface. S04 code MUST be developed on `milestone/M07` after S01–S03 are merged.

**GitWorktreeAdapter constructor:** `(gitPort: GitPort, projectRoot: string)` — will need no changes for relocation, just moved.

**WorktreeError.mergeBackFailed** and **CompleteMilestoneError.mergeBackFailed** — neither exists, both need new factory methods.

## Technical Risks

### R1: S01–S03 code not on `main`
All prerequisite S01–S03 deliverables exist only on the `milestone/M07` branch. S04 cannot be developed or tested against `main`. Implementation must branch from `milestone/M07` tip after S03 is merged there.
**Impact:** Planning must assume S01–S03 interfaces, not verify them from `main`.

### R2: tffDir resolution is a cross-cutting change
The hardcoded `tffDir = join(projectRoot, ".tff")` in `extension.ts` is used by database initialization (ship-records.db, completion-records.db at lines 288, 321) and all downstream use cases. Making this dynamic (worktree-aware) requires careful scoping — global databases (ship-records, completion-records) should stay on the root `.tff/`, while per-slice state (`state.db`, artifacts) should use the worktree `.tff/`.
**Impact:** Cannot simply replace `tffDir` globally. Need a `rootTffDir` (always project root) and `activeTffDir` (worktree if active, else root). Plan must clarify which use cases get which.

### R3: ShipSliceUseCase worktree delete is currently best-effort
Ship currently logs a warning on worktree delete failure and continues (lines 159–163). The spec changes this to fail-fast for merge-back. This is correct for merge-back (data integrity), but the worktree delete itself after successful merge-back could remain best-effort (the state is already merged).
**Impact:** Need clear delineation: merge-back = hard fail, worktree delete after merge-back = best-effort (same as current).

### R4: CompleteMilestoneUseCase already has `baseBranch` = default branch
The spec proposes adding a `defaultBranch` field to `CompleteMilestoneRequestSchema`, but `baseBranch` already IS the default branch in this context (the PR targets the default branch). The `headBranch` is the milestone branch. So `milestoneCodeBranch = parsed.headBranch` and `defaultBranch = parsed.baseBranch`.
**Impact:** No schema extension needed — use existing fields with clear variable aliasing. Removes one planned change.

### R5: Two `tffDir` scopes needed for ship
During ship, the use case needs BOTH paths:
- `worktreeTffDir` = `.tff/worktrees/{sliceId}/.tff/` (source of state to sync)
- `rootTffDir` = `.tff/` (destination to restore milestone state into after merge-back)
Currently `ShipRequest` has `workingDirectory` but this is the worktree working directory, not its `.tff/`. The ship use case can derive `worktreeTffDir` from `WorktreePort.resolveTffDir(sliceId)`.

## Recommendations for Planning

### P1: Develop on `milestone/M07` branch
All S04 tasks must target the milestone branch. First task should verify S01–S03 deliverables are present and interfaces match spec expectations.

### P2: Split tffDir into rootTffDir + activeTffDir
In `extension.ts`, maintain two paths:
- `rootTffDir` = `join(projectRoot, ".tff")` — for global databases, worktree directory structure
- `activeTffDir` — resolved from active worktree if present, else `rootTffDir`
Pass the appropriate one to each consumer. Global repos (ship-records, completion-records) use `rootTffDir`. Per-slice state uses `activeTffDir`.

### P3: Drop `defaultBranch` schema addition for CompleteMilestoneUseCase
Use `parsed.baseBranch` (already the default branch) and `parsed.headBranch` (the milestone branch) with clear variable aliases. Simpler than adding a new field.

### P4: Delineate hard-fail vs best-effort in ship
Merge-back steps (sync, merge, delete state branch) = hard fail. Worktree delete = best-effort (current behavior). Restore of top-level `.tff/` = hard fail (state consistency).

### P5: WorktreePort relocation as isolated first task
Pure mechanical — move 6 files, update 5 import locations, update 2 barrel exports. Run full suite. No logic changes. Should be task 1 to unblock all other work.

### P6: Error factory additions needed
- `ShipError.mergeBackFailed(sliceId: string, cause: Error)` — new static factory
- `CompleteMilestoneError.mergeBackFailed(milestoneId: string, cause: Error)` — new static factory
Both follow existing patterns in their respective error classes.

### P7: CleanupOrphanedWorktreesUseCase also moves
This use case in execution hexagon imports `WorktreePort` and `WorktreeError`. Since the port moves to kernel, either:
- (a) Move the use case to kernel too (it's already a cross-hexagon concern)
- (b) Keep it in execution, update import to `@kernel`
Option (b) is simpler and sufficient.

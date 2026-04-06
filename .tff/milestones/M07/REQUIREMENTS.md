# M07: Team Collaboration, Polish, and Platform Commands

## Goal

Build per-branch state persistence for team collaboration, deliver remaining platform commands, deferred execution improvements (reflection, downshift, pre-dispatch guardrails, compressor notation), and gap analysis features (stack auto-discovery, failure policies, quality metrics, tool/command rules). Code intelligence (G10) deferred to M09.

## Design Decisions

| Decision | Choice |
|---|---|
| Sync mechanism | Temp worktrees for writes (TFF-CC proven), git plumbing for reads |
| SQLite on state branch | JSON export (state-snapshot.json) — human-readable, diffable |
| Branch creation | At discuss — slice gets code + state branch + worktree immediately |
| Worktree lifetime | Discuss → ship (full slice lifecycle) |
| Top-level .tff/ | Full milestone state + shipped slice artifacts |
| Parallel slice merge | Entity-ID merge (commutative, no rebase) |
| Settings in worktrees | Snapshot at creation + /tff:settings --refresh |
| Crash recovery | 3-tier: journal → state branch → parent milestone |

## Requirements

### R01: Infrastructure Reorganization

- Reorganize crowded directories (25+ files) into port/adapter-paired subfolders
- `execution/infrastructure/` (40 files) → checkpoint/, journal/, metrics/, agent-dispatch/, worktree/, overseer/, guardrails/
- `review/infrastructure/` (39 files) → review/, ship-record/, completion-record/, review-dispatch/, executor-query/, review-ui/
- `kernel/agents/` (39 files) → schemas/, dispatch/, status/, services/ (identity files are in src/resources/agents/, not here)
- `review/domain/` (30 files) → aggregates/, value-objects/ (ports/, events/, errors/, services/ already exist)
- No logic changes — mechanical file moves + import updates

**AC:**
- No flat directory has 15+ files (including tests)
- All existing tests pass after reorganization

### R02: StateBranchOpsPort + State Branch Spike

- New `StateBranchOpsPort` in kernel (separate from existing `GitPort`):
  - `createOrphan(branchName)`, `forkBranch(source, target)`, `deleteBranch(name)`, `branchExists(name)`, `renameBranch(old, new)`
  - `syncToStateBranch(stateBranch, files)` — temp worktree write (checkout → copy → commit → cleanup)
  - `readFromStateBranch(stateBranch, path)` — git show, binary-safe (`encoding:'buffer'`)
  - `readAllFromStateBranch(stateBranch)` — full tree read
- `GitStateBranchOpsAdapter` in `infrastructure/git/`
- Full round-trip spike: create orphan → write → read → verify → fork → modify → entity-ID merge → verify

**AC:**
- Full round-trip (write → read → verify) passes
- Fork produces independent branch (modifications don't affect parent)
- Entity-ID JSON merge produces correct merged state
- Temp worktree used for writes; reads use git show (binary-safe)
- StateBranchOpsPort defined in kernel with all required methods

### R03: State Branch CRUD + JSON Export/Import

- Redesigned `StateSyncPort` — branch-aware interface replacing the old push/pull/markDirty:
  - `syncToStateBranch(codeBranch, tffDir)`, `restoreFromStateBranch(codeBranch, tffDir)`
  - `mergeStateBranches(child, parent, sliceId)`, `createStateBranch(codeBranch, parent)`, `deleteStateBranch(codeBranch)`
- `BranchMetaSchema` (version, stateId, codeBranch, stateBranch, lastSyncedAt, lastJournalOffset, dirty)
- `StateSnapshotSchema` extended to include shipRecords and completionRecords (added in M05/M06)
- Schema versioning: `MIGRATIONS` map, Zod `.default()` for additive fields
- State branch creation on milestone/slice creation (fork from parent)
- Sync at lifecycle events (phase transition, milestone open/close, ship, manual sync)
- Advisory lockfile `.tff/.lock` for serialization
- Journal path normalization: local `.tff/milestones/M##/{sliceId}.jsonl` → state branch root `journal.jsonl`
- Metrics sync: `metrics.jsonl` included, append-only on merge

**AC:**
- Round-trip export → import produces identical domain state (including ship-records and completion-records)
- Schema version tracked; old snapshots hydrate via Zod defaults
- State branches created automatically with code branches
- Lock prevents concurrent sync to same state branch
- Journal path correctly normalized between local and state branch layouts
- metrics.jsonl round-trips through state branch sync

### R04: Restore + Post-Checkout Hook + Fallback Detection

- `tff sync --restore <state-branch>`: acquire lock → save dirty state → backup → extract → clear → write → import → replay journal → update branch-meta → clean old backups
- Post-checkout hook: `tff init` / `tff new` appends delimited section to `.git/hooks/post-checkout` (CLI-only, non-blocking)
- Lazy fallback: every TFF command checks `branch-meta.json.codeBranch` vs HEAD, auto-restores on mismatch (primary safety net)

**AC:**
- `git checkout <branch>` auto-restores correct `.tff/` state via hook
- Hook failure is non-blocking (git ignores post-checkout exit codes)
- Dirty state saved to previous branch before restore
- Crash during restore recoverable from `.tff.backup.*`
- Fallback detection triggers restore when hook didn't fire
- Journal replay is idempotent
- `tff init` installs/updates the post-checkout hook

### R05: Worktree-at-Discuss Lifecycle + Rename + Merge-Back

- **Worktree-at-discuss (ARCHITECTURAL CHANGE):**
  - Move worktree creation from execute to discuss phase
  - Modify `StartDiscussUseCase` to: create slice code branch, create slice state branch, create worktree via `WorktreePort`
  - Add `WorktreePort` dependency to workflow hexagon
  - Wire discuss/research/plan phases to operate within worktree
  - Copy top-level `.tff/` into worktree at creation (excl worktrees/, backups)
  - `ExecuteSliceUseCase` reuses existing worktree (no longer creates one)
- **Worktree isolation:** Each worktree gets own `.tff/` + own `state.db`, syncs to own state branch
- **Rename detection:** Stable `stateId`, lazy 3-way disambiguate (missed checkout vs rename vs fresh), `git branch -m`
- **Merge-back on ship:** JSON entity-ID merge — child's owned entities win, parent's others win. Copy slice artifacts. Delete child state branch. Restore top-level `.tff/`.
- **Merge-back on complete-milestone:** Same strategy into `tff-state/main`. Delete milestone state branch.

**AC:**
- Two worktrees on different slices sync concurrently without conflicts
- Branch rename preserves state via stateId
- Ship merges slice state into milestone and deletes slice state branch
- Complete-milestone merges into main state and deletes milestone state branch
- Post-ship restore updates top-level `.tff/` with shipped slice artifacts
- Worktree created at discuss (not execute) — StartDiscussUseCase modified
- Discuss/research/plan phases operate within worktree

### R06: State Reconstruction + /tff:sync

- `ReconstructStateUseCase`: check `tff-state/<codeBranch>` → parent → fresh project
- Crash-during-restore recovery: detect via missing `branch-meta.json` + existing `.tff.backup.*`
- `/tff:sync` command: force push current state to state branch (fully implemented + registered)

**AC:**
- Losing `.tff/` + running any TFF command reconstructs from `tff-state/*`
- `.tff/` NEVER appears in code branch commits
- `/tff:sync` forces immediate state branch update
- Fresh clone + `tff sync` restores full project state

### R07: Execution Pipeline Improvements (Deferred from M04)

Sequential: G-pre → A → B

- **Pre-dispatch guardrails (G-pre):** Extend GuardrailPort with pre-dispatch phase. Checks: scope containment, worktree state, budget. Blocker → task not dispatched.
- **Per-task reflection (A):** Same agent re-reads diff vs ACs after task completion. `ReflectionResultSchema`. Blockers → retry. Warnings → record. Max 1 reflection per task.
- **Model downshift fallback (B):** 3-step chain: retry same model (1x) → downshift (quality→balanced→budget) → escalate. `FallbackStrategySchema`. Checkpoint before every retry.

**AC:**
- Pre-dispatch guardrails block out-of-scope tasks before dispatch
- Reflection catches blockers and triggers retry
- Downshift chain: retry → downshift → escalate works end-to-end
- Checkpoint saved before every retry
- Sequential dependency respected: G-pre → A → B

### R08: Compressor Notation (Deferred from M04)

- Formal logic notation for generated artifacts (skills, plans, specs, research, task prompts)
- Notation vocabulary: ∀, ∃, ∈, ∧, ∨, ¬, →, ⟺, ⇒, ⊆, |
- Schemas/code blocks remain uncompressed
- Existing verbose artifacts compressed lazily (on next edit)

**AC:**
- Compressor reduces tokens by ≥40% on test artifacts vs verbose prose
- No information loss — every branch and edge case survives compression
- Schemas and code blocks uncompressed

### R09: Platform Commands Batch 1 (Daily Use)

- `/tff:quick` — S-tier fast path (skip discuss + research → plan → execute → ship)
- `/tff:debug` — 4-phase systematic diagnosis (reproduce → hypothesize → test → fix)
- `/tff:health` — cross-hexagon state consistency check (SQLite vs journal vs artifacts vs branch-meta)
- `/tff:progress` — dashboard: milestones, slices, tasks, costs, completion %
- `/tff:settings` — view/modify all project settings, show cascade with active values
- `/tff:help` — command reference with descriptions, phases, usage examples

**AC:**
- `/tff:quick` creates and executes S-tier slice end-to-end
- `/tff:debug` opens debugging slice with correct skill injection
- `/tff:health` detects orphaned worktrees, journal/SQLite drift, missing artifacts
- All commands respect autonomy mode

### R10: Platform Commands Batch 2 (Management)

- `/tff:add-slice`, `/tff:remove-slice`, `/tff:insert-slice` — slice management
- `/tff:rollback` — revert execution commits for a slice
- `/tff:audit-milestone` — milestone completion audit vs original intent
- `/tff:map-codebase` — parallel doc-writer agents for structured documentation

**AC:**
- Add/remove/insert with correct milestone associations
- Remove refuses in-progress/completed slices
- Rollback cleanly reverts to pre-execution state
- Audit produces gap analysis between requirements and delivered work

### R11: Stack Auto-Discovery (Gap G04)

- `DiscoverStackUseCase`: scan for package.json, Cargo.toml, pyproject.toml, go.mod, linter/test configs
- Auto-populate `settings.yaml` defaults on `tff init`
- Re-discovery on `/tff:settings`
- Manual overrides take precedence

**AC:**
- Stack detected automatically for Node/TS projects (primary target)
- Manual overrides not clobbered

### R12: Failure Policy Model (Gap G02)

- Per-phase configurable: `strict | tolerant | lenient`
- Defaults: execution=strict, research=tolerant, review=strict, suggestions=lenient
- Configurable in `settings.yaml` under `workflow.failurePolicies`

**AC:**
- Failure policy respected at phase transitions
- Tolerant mode records failures without blocking

### R13: Per-Stage Quality Metrics (Gap G03)

- `QualitySnapshotSchema`: lintErrors, testsPassed, testsFailed, testsSkipped, toolInvocations, toolFailures, reviewScore, filesChanged, linesAdded, linesRemoved
- Captured per stage (executing, verifying, reviewing)
- Feeds into future metrics-informed suggestions (M08)

**AC:**
- Quality signals captured per stage
- Trends queryable by milestone/slice

### R14: Configurable Tool/Command Rules Per Agent (Gap G09)

- `ToolPolicySchema` in settings: defaults.blocked, byTier, byRole
- Enforced at dispatch time via tool filtering in `AgentDispatchConfigSchema`
- Security auditor = read-only. S-tier = no sub-agents. Executors = no destructive git.

**AC:**
- Tool policies enforced before dispatch
- Per-tier and per-role rules composable
- Configurable in settings

### R15: Production Wiring Completeness

- Replace all in-memory/stub adapters in `extension.ts` with persistent implementations
- `InMemoryWorkflowSessionRepository` → new `SqliteWorkflowSessionRepository`
- `InMemoryReviewRepository` → complete existing `SqliteReviewRepository` (currently throws "Not implemented")
- `InMemoryVerificationRepository` → complete existing `SqliteVerificationRepository` (currently throws "Not implemented")
- `InMemoryJournalRepository` → wire existing `JsonlJournalRepository`
- `InMemoryCheckpointRepository` → wire existing `MarkdownCheckpointRepository`
- `InMemoryReviewUIAdapter` → wire `PlannotatorReviewUIAdapter` / `TerminalReviewUIAdapter`
- `NoOpContextStaging` → implement real `ContextStagingPort` adapter
- `ExecuteSliceUseCase` stub → wire real use case with full dependency graph
- `CachedExecutorQueryAdapter` stub → implement real executor query from execution session
- Persist `TurnMetrics` alongside `TaskMetrics` in `metrics.jsonl` (currently collected but discarded)

**AC:**
- Zero `InMemory*` or `NoOp*` adapters in `extension.ts` (except `InMemoryAgentEventHub` — intentional in-process pub/sub)
- Zero `AlwaysUnder*` budget stubs (except `AlwaysUnderBudgetAdapter` — deferred to cost tracking milestone)
- Workflow session state survives restart
- Review and verification records persist across sessions
- Execution journal and checkpoints persist to filesystem
- Real ExecuteSliceUseCase wired and functional
- TurnMetrics (tool counts, per-turn timing) included in metrics.jsonl entries

## Deferred to M09

| ID | Feature | Reason |
|---|---|---|
| G10 | Code Intelligence / AST/LSP (Tree-sitter) | High risk, P3 priority. Native bindings + per-language grammars would block delivery. |

## Slice Mapping

| Slice | Requirements |
|---|---|
| S01 | R01 (infra reorg) + R02 (StateBranchOpsPort + spike) |
| S02 | R03 (CRUD + export/import) |
| S03 | R04 (restore + hook + fallback) |
| S04 | R05 (worktree-at-discuss + rename + merge-back) |
| S05 | R06 (state reconstruction + /tff:sync) |
| S06 | R07 (execution pipeline: G-pre → A → B) |
| S07 | R08 (compressor notation) |
| S08 | R09 (commands batch 1) |
| S09 | R10 (commands batch 2) |
| S10 | R11 + R12 + R13 + R14 (gap features) |
| S11 | R15 (production wiring completeness) |

## Invariants

- I1: `.tff/` never appears on code branches (`.gitignore` + `tff init`)
- I2: State branches have no shared history with code branches (true orphan)
- I3: Each state branch mirrors exactly one code branch
- I4: Worktree exists from discuss through ship
- I5: Active slice artifacts in worktrees; flow back after ship
- I6: Entity-ID merge is commutative for non-overlapping slices
- I7: Journal replay is idempotent
- I8: Post-ship restore always runs
- I9: Crash never corrupts state branch (temp worktree + atomic commit)
- I10: ALL artifacts live inside `.tff/` — zero leakage

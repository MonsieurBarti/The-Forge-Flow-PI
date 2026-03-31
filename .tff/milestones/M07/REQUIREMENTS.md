# M07: Team Collaboration, Polish, and Platform Intelligence

## Goal

Build per-branch state persistence for team collaboration, deliver remaining platform commands, and add gap analysis features: stack auto-discovery, failure policies, shared project memory, quality metrics, tool/command rules, and code intelligence.

## Requirements

### R01: State Branch CRUD

- Every code branch gets a mirrored orphan state branch (`tff-state/<branch>`)
- Root `tff-state/main` is a true git orphan; children forked via `git branch`
- `BranchMetaSchema`: version, stateId (stable, survives renames), codeBranch, stateBranch, lastSyncedAt, lastJournalOffset, dirty
- Create: fork from parent state branch on code branch creation
- Sync: at lifecycle events only (phase transition, milestone open/close, ship, manual sync, shutdown)
- Uses git plumbing (no temp worktrees): `git hash-object -w`, `git mktree`, `git commit-tree`, `git update-ref`
- Read via `git archive` or `git cat-file`
- Serialized via `.tff/.lock` advisory lockfile

**AC:**
- State branches created/deleted automatically with code branches
- Concurrent worktrees sync to different state branches without conflicts
- Git plumbing used (no temp worktree overhead)

### R02: JSON Export/Import (SQLite <-> state-snapshot.json)

- `StateSnapshotSchema`: version, exportedAt, project, milestones, slices, tasks, workflowSession
- SQLite `.db` files never committed to git
- Full export on sync; import on restore
- Schema evolution: Zod `.default()` for additive fields, migration functions per version bump
- `MIGRATIONS` map keyed by version number

**AC:**
- Round-trip: export -> import produces identical domain state
- Schema version tracked; old snapshots migrated automatically

### R03: Post-Checkout Hook + Fallback Detection

- `post-checkout` git hook auto-restores `.tff/` on branch switch via `tff sync --restore`
- Hook appended to existing hooks (delimited section)
- Restore: back up `.tff/`, pull from state branch, clear `.tff/`, write artifacts, import snapshot, replay journal
- Fallback: every TFF command checks `branch-meta.json.codeBranch` vs actual branch, triggers restore on mismatch
- `tff init` / `tff new` ensures `.tff/` in `.gitignore` and installs hook

**AC:**
- `git checkout <branch>` auto-restores correct `.tff/` state
- Hook failure is non-blocking (git ignores post-checkout exit code)
- Commands self-heal on branch mismatch

### R04: Worktree Isolation Integration

- Each worktree has own `.tff/` tied to own state branch
- Worktree creation restores `.tff/` from corresponding state branch
- Zero conflicts: different worktrees -> different state branches -> different git refs

**AC:**
- Two worktrees on different slices sync concurrently without conflicts

### R05: Rename Detection + State Branch Migration

- Stable `stateId` survives code branch renames
- Lazy detection: TFF command checks codeBranch vs HEAD
- Disambiguate: missed checkout (state branch exists for current HEAD) vs rename (state branch exists for old name) vs fresh
- Rename: `git branch -m tff-state/<old> tff-state/<new>`, then update branch-meta.json
- Crash between rename and meta update handled by existing disambiguation

**AC:**
- Renaming a code branch preserves state linkage via stable stateId
- No expensive stateId scan needed

### R06: Merge-Back on Ship/Complete-Milestone

- `/tff:ship`: programmatic merge of slice state into parent milestone state by entity ID
  - Child's owned entities (shipped slice + tasks) win
  - Parent's other entities win (updated by other shipped slices)
  - Artifacts: per-slice directories have no overlap by construction
  - Delete slice state branch after merge
- `/tff:complete-milestone`: same entity-ID merge into `tff-state/main`, delete milestone state branch

**AC:**
- Ship merges slice state back and deletes slice state branch
- Journal replay idempotent after merge

### R07: State Reconstruction

- `ReconstructStateUseCase`: recover full state from git alone
  1. Check if `tff-state/<branch>` exists -> pull and hydrate
  2. If not, check parent state branch -> fork from there
  3. If nothing -> fresh project
  4. Replay local journal entries on top
- Crash during restore: detect via missing `branch-meta.json` + existing `.tff.backup.*` -> restore from backup

**AC:**
- Losing `.tff/` + running any TFF command reconstructs from `tff-state/*`
- `.tff/` NEVER appears in code branch commits

### R08: Remaining Platform Commands

- `/tff:quick` -- S-tier fast path (skip discuss + research -> plan -> execute -> ship)
- `/tff:debug` -- 4-phase systematic diagnosis (reproduce -> hypothesize -> test -> fix)
- `/tff:health` -- cross-hexagon state consistency check
- `/tff:progress` -- dashboard: milestones, slices, tasks, costs, completion %
- `/tff:add-slice`, `/tff:remove-slice`, `/tff:insert-slice` -- slice management
- `/tff:rollback` -- revert execution commits for a slice
- `/tff:audit-milestone` -- milestone completion audit vs original intent
- `/tff:map-codebase` -- parallel doc-writer agents for structured documentation
- `/tff:sync` -- manual bidirectional state sync
- `/tff:settings` -- view/modify all project settings
- `/tff:help` -- command reference

**AC:**
- All commands produce actionable output with next-step suggestions
- Each command respects autonomy mode

### R09: Stack Auto-Discovery (Gap G04)

- `DiscoverStackUseCase`: runtime detection of project tech stack
- Scans project root for: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, linter configs (`.eslintrc`, `biome.json`), test runner configs (vitest, jest, pytest), CI configs (`.github/workflows/`, `.gitlab-ci.yml`)
- Auto-populates `settings.yaml` defaults on `tff init`
- Manual overrides in settings take precedence
- Re-discovery on `/tff:settings` or explicit trigger

**AC:**
- Stack detected automatically for supported ecosystems (Node/TS, Rust, Python, Go)
- Detected stack reflected in default settings
- Manual overrides not clobbered

### R10: Failure Policy Model (Gap G02)

- Per-phase configurable failure behavior: `strict | tolerant | lenient`
- `strict`: any failure blocks progression (execution, security review)
- `tolerant`: continues on non-critical failures, records them (research, code review minors)
- `lenient`: best-effort, logs warnings (suggestions, pattern detection)
- Configurable per phase in `settings.yaml` under `workflow.failurePolicies`
- Defaults: execution=strict, research=tolerant, review=strict, suggestions=lenient

**AC:**
- Failure policy checked at each phase transition
- Tolerant mode records failures without blocking
- Defaults are sensible out of the box

### R11: Shared Memory Per Project (Gap G07)

- `ProjectMemoryPort` with key-value store scoped to project
- Storage: `.tff/memory/` directory or SQLite table
- Categories: architecture-decisions, domain-conventions, gotchas, resolved-bugs
- Read/write from any agent session
- Auto-populated from successful task completions (links to M06 R06 knowledge base)
- Injected into agent context based on relevance (file paths, hexagon, phase)
- Synced via state branches (R01-R06)
- Eviction: LRU with configurable max entries, staleness detection
- Distinct from L0-L4 tiered memory (M06 R10) -- this is persistent cross-session, not per-agent promotion

**AC:**
- Memory persists across sessions and agents
- Relevant memories injected into agent context
- Stale entries evicted automatically

### R12: Per-Stage Quality Metrics (Gap G03)

- `QualitySnapshotSchema`: lintErrors, testsPassed, testsFailed, testsSkipped, toolInvocations, toolFailures, reviewScore, filesChanged, linesAdded, linesRemoved
- Captured per stage (executing, verifying, reviewing)
- Stored alongside TaskMetrics (M06 R09)
- Feeds into metrics-informed suggestions
- Enables trend analysis across slices/milestones

**AC:**
- Quality signals captured per stage
- Trends queryable by milestone/slice

### R13: Configurable Tool/Command Rules Per Agent (Gap G09)

- `ToolPolicySchema` in settings:
  - `defaults.blocked`: globally blocked tools/commands
  - `byTier`: per-complexity-tier allowed/blocked (e.g., S-tier: no Agent tool)
  - `byRole`: per-agent-role allowed/blocked (e.g., security-auditor: read-only)
- Enforced at dispatch time via tool filtering in `AgentDispatchConfigSchema`
- Security auditor = read-only (Read, Grep, Glob only)
- S-tier = no sub-agent spawning
- Executors = no destructive git operations

**AC:**
- Tool policies enforced before dispatch (not after)
- Per-tier and per-role rules composable
- Configurable in settings

### R14: Code Intelligence -- AST/LSP (Gap G10)

- Optional `CodeIntelligencePort` abstract class
- Tree-sitter parsing for supported languages (TS, Rust, Python, Go)
- Extract: imports, exports, class/function definitions, dependency graph
- Use cases: smarter task file scoping, impact analysis for changes, review scope narrowing
- Heavy dependency -- implemented as optional adapter (graceful degradation if unavailable)

**AC:**
- Semantic analysis available when Tree-sitter is installed
- Graceful fallback to file-path-based routing when unavailable
- Dependency graph extracted for supported languages

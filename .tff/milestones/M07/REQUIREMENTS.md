# M07: Team Collaboration and Polish

## Goal

Build the team collaboration layer (orphan branch sync, state reconstruction), GitHub integration, remaining commands, and documentation for npm publishing.

## Requirements

### R01: Orphan Branch Sync

- Two-tier persistence:
  - **Tier 1 (Journal):** append-only JSONL in `.tff/journal.jsonl`, every mutation, instant
  - **Tier 2 (Branch Sync):** debounced push to `tff-state` orphan branch
- Sync triggers:
  - Task started: journal + mark dirty (debounce 30s)
  - File written: journal + mark dirty
  - Task completed: journal + **force sync**
  - Phase transition: journal + **force sync**
  - Every 5 minutes: force sync if dirty
  - Graceful shutdown: flush journal + force sync
  - SIGTERM/SIGINT: best-effort flush + sync

**AC:**
- Journal survives crashes (append-only, no corruption on partial write)
- Force sync on critical state changes (task completion, phase transition)
- Debounce prevents thrashing on rapid updates

### R02: SyncScheduler

- `SyncScheduler` in `infrastructure/git/`: owns debounce timer, dirty flag, signal handlers
- `markDirty()`, `forceSync()`, `registerSignalHandlers()`, `shutdown()`
- Wired in CLI entry point, passed to hexagons that need sync

**AC:**
- SIGTERM/SIGINT handlers registered and tested
- Graceful shutdown flushes all pending state

### R03: State Reconstruction

- `ReconstructStateUseCase`: pull tff-state branch -> extract artifacts -> hydrate SQLite -> replay journal
- If no tff-state: fresh project
- Schema versioning: `StateSnapshotSchema` with version field
- Migration functions per version bump (registered in MIGRATIONS map)
- Zod `.default()` handles additive fields

**AC:**
- Reconstruction from tff-state branch works end-to-end
- Schema migrations tested (old snapshot -> current schema)
- Missing tff-state treated as fresh project (no error)

### R04: Conflict Resolution

- Different slices: auto-merge (no overlap)
- Same slice: last-push wins (one person owns a slice at a time)
- Snapshot merge: 3-way entity-level merge
  - Status: latest timestamp wins
  - Design/content: conflict flagged
  - Dependencies: union
  - KV pairs: latest timestamp per key

**AC:**
- Cross-slice merge is automatic
- Same-slice conflict detected and flagged

### R05: GitHub Port + gh CLI Adapter

- `GitHubPort` implementation using gh CLI (`GhCliAdapter`)
- Commands: createPullRequest, listPullRequests, addComment
- All return `Result<T, GitHubError>`
- PR body format: summary, test plan, generated-by footer

**AC:**
- Adapter tested against real GitHub (integration test or mock)
- Error cases (auth failure, rate limit) return typed errors

### R06: Dynamic Re-Prioritization

- After task failures: re-evaluate dependent task ordering
- Priority factors: dependency criticality (tasks unblocking most downstream work), estimated cost, risk level
- When high-priority task fails: defer dependents, try alternative approach first

**AC:**
- Task failure triggers re-evaluation of remaining task ordering
- Dependents of failed tasks are deferred (not started)

### R07: Remaining Commands

- `/tff:quick` -- S-tier shortcut: skip discuss + research, create slice, lightweight plan, hand off to standard pipeline
- `/tff:debug` -- Phase 1 (diagnose, no slice) then Phase 2 (creates slice, converges on standard pipeline)
- `/tff:health` -- cross-hexagon state consistency check
- `/tff:progress` -- dashboard: milestones, slices, tasks, costs
- `/tff:add-slice`, `/tff:remove-slice`, `/tff:insert-slice` -- slice management
- `/tff:rollback` -- revert execution commits for a slice
- `/tff:audit-milestone` -- milestone completion audit against original intent
- `/tff:map-codebase` -- 3 parallel doc-writer agents -> STACK.md, ARCHITECTURE.md, CONCERNS.md, CONVENTIONS.md
- `/tff:sync` -- manual bidirectional sync
- `/tff:help` -- command reference

**AC:**
- Quick and debug are entry points that converge on standard pipeline (not parallel pipelines)
- Health check detects inconsistencies between SQLite state, markdown artifacts, and git branches
- All commands end with next-step suggestion

### R08: Documentation and Publishing

- README.md with installation, quick start, architecture overview
- npm package: `@the-forge-flow/cli`
- `tff` binary entry point
- PI extensions installable into vanilla `pi` CLI
- All 18 methodology skills ported as PI skills (SKILL.md files)

**AC:**
- `npm install -g @the-forge-flow/cli` installs working `tff` binary
- Extensions work both standalone and within vanilla `pi`
- All skills loadable via PI's skill discovery

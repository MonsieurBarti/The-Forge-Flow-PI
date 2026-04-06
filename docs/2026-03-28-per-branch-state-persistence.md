# Per-Branch Orphan State Persistence

> Supersedes: Section 7 ("Persistence & State Management") of `2026-03-25-tff-pi-design.md`
> Status: Approved
> Date: 2026-03-28

## 1. Problem

The original design uses a single `tff-state` orphan branch for all TFF state. This breaks under three scenarios:

1. **Concurrent worktrees** -- two agents working on different slices simultaneously both write to the same orphan branch, causing conflicts
2. **Branch switching** -- `.tff/` is gitignored so it persists across `git checkout`, but its contents belong to the previous branch, leading to stale/wrong state
3. **Full recovery** -- cloning fresh or losing `.tff/` requires pulling from `tff-state`, but a single branch mixes state from all milestones/slices with no clear isolation

### Constraints

- `.tff/` MUST remain gitignored on code branches (main, milestone/*, slice/*) -- PRs stay clean. `tff init` / `tff new` MUST ensure `.tff/` is in `.gitignore`
- State MUST be 100% recoverable from git alone -- no external dependencies
- Concurrent worktrees MUST NOT conflict
- Branch rename MUST NOT orphan state

## 2. Design

### 2.1 Branch Topology

Every code branch gets a mirrored orphan state branch:

```
Code branches:              State branches:
  main                        tff-state/main              (orphan root)
  milestone/M04               tff-state/milestone/M04     (forked from tff-state/main)
    slice/M04-S01               tff-state/slice/M04-S01   (forked from tff-state/milestone/M04)
    slice/M04-S02               tff-state/slice/M04-S02   (forked from tff-state/milestone/M04)
```

The root state branch (`tff-state/main`) is a true git orphan -- no shared history with code branches. Child state branches (milestone, slice) are forked from their parent state branch via `git branch`, so they share history *within the state branch family* but have no common ancestor with code branches. This shared state-branch history is intentional: it enables `git merge` when merging state back to parent on ship. Concurrent writes to different state branches never conflict because each targets a different ref.

### 2.2 Local State (`.tff/`)

Unchanged from original spec. All TFF state lives in `.tff/` at project root, always gitignored:

```
.tff/
  state.db                     # SQLite: status, deps, transitions
  settings.yaml                # Local settings overrides
  journal.jsonl                # Append-only mutation journal
  PROJECT.md                   # Project vision
  branch-meta.json             # Current branch mapping (stateId, codeBranch, stateBranch)
  milestones/
    M04/
      REQUIREMENTS.md
      slices/
        M04-S01/
          SPEC.md
          PLAN.md
          RESEARCH.md
          CHECKPOINT.md
  skills/                      # Custom project skills
  observations/                # JSONL observation logs
  metrics.json                 # Cost tracking
  worktrees/                   # Git worktrees (ephemeral)
```

New file: `branch-meta.json` -- tracks the mapping between local state and its state branch:

```typescript
export const BranchMetaSchema = z.object({
  version: z.number().int().default(1), // Schema version for future migrations
  stateId: z.string(),           // Stable ID (e.g., "M04-S01"), survives renames
  codeBranch: z.string(),        // Current code branch name
  stateBranch: z.string(),       // Current state branch name
  lastSyncedAt: TimestampSchema.optional(),
  lastJournalOffset: z.number().int().default(0), // Journal entries up to this offset are baked into the snapshot
  dirty: z.boolean().default(false),
});
```

### 2.3 SQLite Persistence: JSON Export

SQLite `.db` files are never committed to git. Instead, state is exported to JSON before sync:

```
tff-state/milestone/M04 (orphan branch contents):
  state-snapshot.json            # Full SQLite export (diffable, mergeable)
  branch-meta.json               # State identity + branch mapping
  settings.yaml                  # Team-shared settings
  artifacts/
    PROJECT.md
    M04/
      REQUIREMENTS.md
      slices/
        M04-S01/
          SPEC.md
          PLAN.md
          RESEARCH.md
          CHECKPOINT.md
  journal.jsonl                  # Archived journal entries
```

State snapshot schema (unchanged from original spec):

```typescript
export const StateSnapshotSchema = z.object({
  version: z.number().int(),
  exportedAt: TimestampSchema,
  project: ProjectPropsSchema.optional(),
  milestones: z.array(MilestonePropsSchema),
  slices: z.array(SlicePropsSchema),
  tasks: z.array(TaskPropsSchema),
  workflowSession: WorkflowSessionPropsSchema.optional(),
});
```

Schema evolution: Zod `.default()` for additive fields. Migration functions per version bump for breaking changes, registered in a `MIGRATIONS` map keyed by version number.

### 2.4 State Branch Lifecycle

#### Create (fork from parent)

When a new code branch is created, its state branch forks from the parent state branch:

```
main                    -> tff-state/main
milestone/M04           -> fork tff-state/main          -> tff-state/milestone/M04
slice/M04-S01           -> fork tff-state/milestone/M04 -> tff-state/slice/M04-S01
```

Fork operation:
1. `git branch tff-state/slice/M04-S01 tff-state/milestone/M04` (ref copy, no checkout)
2. Read parent snapshot via `git cat-file`, add slice-specific state
3. Write updated snapshot to new state branch via git plumbing (see section 2.9)

The forked state branch inherits full parent context (project, milestone, other slices) so the slice has awareness of the broader project state.

#### Sync (lifecycle events only)

No debounced timer. Sync happens at well-defined lifecycle points:

| Event | Journal (local) | State Branch Sync |
|-------|-----------------|-------------------|
| Task started | Append | -- |
| File written | Append | -- |
| Task completed | Append | -- |
| Slice phase transition | Append | **Auto-sync** |
| Milestone open | Append | **Auto-sync** |
| Milestone close | Append | **Auto-sync** |
| `/tff:ship` (pre-PR) | Append | **Auto-sync** |
| `/tff:sync` (manual) | Append | **Auto-sync** |
| Graceful shutdown | Flush | **Best-effort sync** |
| SIGTERM/SIGINT | Best-effort flush | **Best-effort sync** |

Max data loss: work since last phase transition (journal provides local recovery for everything in between).

Sync algorithm (uses git plumbing, see section 2.9; serialized via `.tff/.lock`):
1. Acquire `.tff/.lock`. Export SQLite to `state-snapshot.json`
2. Record current journal length as `lastJournalOffset`
3. Hash all `.tff/` artifacts + snapshot + `branch-meta.json` via `git hash-object -w`
4. Build tree via `git mktree`
5. Create commit via `git commit-tree`, parented on current state branch tip
6. Update state branch ref via `git update-ref`
7. Update local `branch-meta.json` with `lastSyncedAt` and `lastJournalOffset`

#### Restore (post-checkout hook)

A `post-checkout` git hook auto-hydrates `.tff/` when switching code branches:

```bash
#!/bin/sh
# .git/hooks/post-checkout
# Args: $1=prev-ref, $2=new-ref, $3=branch-checkout-flag
[ "$3" = "0" ] && exit 0  # file checkout, not branch

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
[ -z "$BRANCH" ] && exit 0  # detached HEAD

STATE_BRANCH="tff-state/${BRANCH}"

# Check if state branch exists
git rev-parse --verify "$STATE_BRANCH" >/dev/null 2>&1 || exit 0

# Delegate to tff CLI for the heavy lifting
tff sync --restore "$STATE_BRANCH"
```

The `tff sync --restore` command (serialized via `.tff/.lock` advisory lockfile — if lock is held, wait up to 5s then abort):
1. Acquire `.tff/.lock` (advisory flock). Save current `.tff/` to previous state branch (if dirty)
   - If save fails: **abort restore**, warn user ("unsaved state for branch X, run `/tff:sync` manually before switching"). The post-checkout hook exits non-zero but does not block the checkout (git ignores hook exit codes for post-checkout).
2. Back up `.tff/` to `.tff.backup.<timestamp>/` (safety net, cleaned up after 3 successful restores)
3. Pull state from `$STATE_BRANCH` using git plumbing (see 2.9)
4. Clear `.tff/` (except `worktrees/` and `*.backup.*`)
5. Write artifacts from state tree into `.tff/`
6. Import `state-snapshot.json` into SQLite
7. Replay local `journal.jsonl` entries with offset > `lastJournalOffset` from snapshot (skip already-baked entries)
8. Update `branch-meta.json`

#### Merge back (on ship)

When a slice is shipped, its state is **programmatically merged** back into the parent. Git's line-based merge cannot handle `state-snapshot.json` (JSON arrays conflict when both sides modify milestones/slices/tasks). Instead, TFF reads both snapshots and merges by entity ID:

```
/tff:ship M04-S01:
  1. Final sync of slice state to tff-state/slice/M04-S01
  2. Programmatic merge:
     a. Read parent snapshot from tff-state/milestone/M04
     b. Read child snapshot from tff-state/slice/M04-S01
     c. Merge by entity ID: child's slice entities win (owner),
        parent's other entities win (they may have been updated by other shipped slices)
     d. Copy child's slice-specific artifacts into parent tree
     e. Write merged snapshot + artifacts as new commit to tff-state/milestone/M04
  3. Delete tff-state/slice/M04-S01
```

When a milestone is completed:
```
/tff:complete-milestone M04:
  1. Final sync of milestone state to tff-state/milestone/M04
  2. Programmatic merge (same entity-ID strategy) into tff-state/main
  3. Delete tff-state/milestone/M04
```

Merge rules for `state-snapshot.json`:
- **Milestones/slices/tasks**: merge by entity ID. Child's owned entities (the shipped slice + its tasks) take precedence. Parent's other entities take precedence (they reflect work from other slices shipped in the meantime).
- **Project-level fields**: parent wins (canonical).
- **Artifacts**: per-slice directories have no overlap by construction. Copy child's slice artifacts into parent tree.

#### Rename handling

Each state snapshot contains a stable `stateId` (e.g., `"M04-S01"`) that survives branch renames:

```json
{
  "stateId": "M04-S01",
  "codeBranch": "slice/M04-S01",
  "stateBranch": "tff-state/slice/M04-S01"
}
```

Detection happens lazily: any TFF command checks `branch-meta.json.codeBranch` against `git symbolic-ref --short HEAD`. On mismatch, disambiguate:

```
currentHead = git symbolic-ref --short HEAD
metaBranch  = branch-meta.json.codeBranch

if currentHead != metaBranch:
  if tff-state/<currentHead> exists:
    // This is a missed checkout (hook didn't fire).
    // The correct state branch already exists for this code branch.
    -> trigger restore from tff-state/<currentHead>
  else if tff-state/<metaBranch> exists:
    // This is a rename: code branch changed name but state branch still has old name.
    -> rename tff-state/<metaBranch> to tff-state/<currentHead>
    -> update codeBranch and stateBranch in branch-meta.json
    -> stateId stays unchanged (stable identity)
  else:
    // Neither exists. Fresh branch or fully lost state.
    -> check parent state branch, fork from there (see 2.6 Crash Recovery)
```

Rename operation order: rename the git ref first (`git branch -m tff-state/<old> tff-state/<new>`), then update `branch-meta.json`. If a crash happens between the two steps, the existing three-way disambiguation logic (above) handles it: `tff-state/<currentHead>` now exists → treated as missed checkout → triggers restore, which is the correct behavior. No expensive stateId scan needed.

### 2.5 Worktree Isolation

Git worktrees share `.git/` but each has its own working tree. Since `.tff/` lives in the working tree (not `.git/`), each worktree naturally gets its own `.tff/`:

```
/project/                       # main worktree
  .git/                         # shared git database
  .tff/                         # state for current branch (e.g., milestone/M04)
  src/

/project/.tff/worktrees/M04-S01/   # slice worktree (created by tff)
  .tff/                         # state for slice/M04-S01 (independent)
  src/
```

Each worktree's `.tff/` is tied to its own state branch. Zero conflicts because:
- Different worktrees = different code branches = different state branches
- Sync writes to different state branches = no git conflicts
- Local `.tff/` directories are physically separate = no filesystem conflicts

Worktree creation (`tff execute` with worktree isolation):
1. `git worktree add .tff/worktrees/M04-S01 slice/M04-S01`
2. Restore `.tff/` in the new worktree from `tff-state/slice/M04-S01`
3. Agent operates in the worktree with its own independent `.tff/`

### 2.6 Crash Recovery

Three tiers of recovery:

| Scenario | Recovery | Data Loss |
|----------|----------|-----------|
| Agent crash, `.tff/` intact | Replay `journal.jsonl` | None |
| Agent crash, `.tff/` gone | Pull from `tff-state/<branch>`, hydrate `.tff/`, replay journal | At most: work since last lifecycle sync |
| No `tff-state/<branch>` exists | Fresh state; `/tff:new` starts clean | N/A (new project) |
| `.tff/` gone + no state branch | Check parent state branch, fork from there | Lose slice-specific state since last parent merge |
| Crash during restore (`.tff/` cleared, write incomplete) | Detect via missing `branch-meta.json` + existing `.tff.backup.*`; restore from backup, reattempt | None (backup was taken before clear) |

State reconstruction:

```typescript
export class ReconstructStateUseCase {
  async execute(codeBranch: string): Promise<Result<ReconstructionReport, never>> {
    const stateBranch = `tff-state/${codeBranch}`;

    // 1. Check if state branch exists
    // 2. If yes: pull state branch, extract artifacts into .tff/, hydrate SQLite
    // 3. If no: check parent state branch (milestone for slice, main for milestone)
    // 4. If parent exists: fork from parent, create state branch
    // 5. If nothing: fresh project
    // 6. Replay any local journal.jsonl entries on top
    // 7. Write branch-meta.json
  }
}
```

### 2.7 Project Initialization & Hook Installation

`tff init` (or `tff new`) performs two setup steps:

**Step 1: Gitignore enforcement.** Ensure `.tff/` is in `.gitignore`. If `.gitignore` exists, append `.tff/` if not already present. If `.gitignore` doesn't exist, create it with `.tff/`. This is the AC1 guarantee.

**Step 2: Post-checkout hook.** If the hook already exists, TFF appends its logic as a clearly delimited section:

```bash
# --- TFF STATE SYNC (do not edit) ---
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
[ -n "$BRANCH" ] && [ "$3" = "1" ] && \
  git rev-parse --verify "tff-state/${BRANCH}" >/dev/null 2>&1 && \
  tff sync --restore "tff-state/${BRANCH}" 2>/dev/null
# --- END TFF STATE SYNC ---
```

Fallback if hook is not installed (GUI clients, fresh clones): every TFF command checks `branch-meta.json.codeBranch` against the actual branch. If mismatched, triggers restore before proceeding (same as the "lazy detection" approach, as a safety net).

### 2.8 Settings Cascade

Unchanged from original spec:

```
Hardcoded defaults (Zod .default() in schema)
  <- tff-state/main settings.yaml (team-shared)
    <- .tff/settings.yaml (local overrides)
      <- environment variables (TFF_MODEL, TFF_AUTONOMY, etc.)
```

Team settings now live on `tff-state/main` (was `tff-state` root).

### 2.9 Git Plumbing for Sync (no temporary worktrees)

To avoid the overhead of creating/destroying temporary worktrees on every sync, state branch reads and writes use git plumbing commands directly:

**Write (sync .tff/ -> state branch):**
1. Build a tree object from `.tff/` artifacts + exported `state-snapshot.json` using `git mktree` + `git hash-object -w`
2. Create a commit pointing to that tree with `git commit-tree`, parented on the current state branch tip
3. Update the state branch ref with `git update-ref`

**Read (state branch -> .tff/):**
1. `git archive tff-state/<branch> | tar -x -C .tff/` (single subprocess, extracts full tree)
2. For individual file reads (e.g., just `branch-meta.json`): `git cat-file blob tff-state/<branch>:path`

This is how tools like `git stash` work internally -- manipulating refs without touching the working tree. Sync becomes nearly instantaneous regardless of repository size.

The fork operation (section 2.4) still uses `git branch` (a single ref copy, no checkout needed).

## 3. Non-Goals

- Remote push of state branches (team sync over network) -- deferred, local-only for now
- Conflict resolution for same-slice concurrent edits -- one person owns a slice at a time
- Incremental/delta sync -- full snapshot on each sync (snapshots are small enough)
- Git-level merge drivers for `state-snapshot.json` -- programmatic entity-ID merge handles this (section 2.4)

## 4. Acceptance Criteria

- AC1: `.tff/` NEVER appears in code branch commits or PRs
- AC2: `git checkout <branch>` auto-restores correct `.tff/` state via post-checkout hook
- AC3: Two worktrees on different slices can sync state concurrently without conflicts
- AC4: Renaming a code branch preserves state branch linkage via stable `stateId`
- AC5: Losing `.tff/` and running any TFF command reconstructs state from matching `tff-state/*` branch
- AC6: `/tff:ship` merges slice state back into parent and deletes the slice state branch
- AC7: Journal replay is idempotent -- replaying the same entries produces identical state
- AC8: Hook fallback: if post-checkout hook is missing, TFF commands detect branch mismatch and self-heal

## 5. Milestone Placement

This work belongs to **M06 (Team Collaboration & Polish)** in the roadmap. It replaces the original single-orphan-branch design with the per-branch approach described here.

Suggested M06 slice breakdown for this feature:
- Slice: State branch CRUD (create/fork, sync, restore, delete)
- Slice: JSON export/import (SQLite <-> state-snapshot.json)
- Slice: Post-checkout hook + fallback detection
- Slice: Worktree isolation integration
- Slice: Rename detection + state branch migration
- Slice: Merge-back on ship/complete-milestone

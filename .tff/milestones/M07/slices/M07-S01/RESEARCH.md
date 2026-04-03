# M07-S01 Research: Infrastructure Reorg + State Branch Ops Spike

## Part A: Directory Reorganization

### Current State — Files Per Directory

| Directory | Total | Non-test | Test | Subdirs exist |
|---|---|---|---|---|
| `execution/infrastructure/` | 52 | 20 | 22 | `rules/` (11 files), `pi/` (4 files) |
| `review/infrastructure/` | 39 | 20 | 19 | none |
| `kernel/agents/` | 39 | 21 | 18 | none |
| `review/domain/` | 76 total | — | — | `ports/` (14), `errors/` (17), `events/` (7), `services/` (4) = 34 flat remaining |

### Proposed Organization

#### execution/infrastructure/ (52 files → 8 subfolders)

| Subfolder | Files | Contents |
|---|---|---|
| `repositories/checkpoint/` | 5 | markdown-checkpoint repo, in-memory, contract spec |
| `repositories/journal/` | 5 | jsonl-journal repo, in-memory, contract spec |
| `repositories/metrics/` | 5 | jsonl-metrics repo, in-memory, contract spec |
| `adapters/execution-session/` | 3 | markdown + in-memory execution session |
| `adapters/agent-dispatch/` | 4 | pi-agent-dispatch, in-memory, contract spec |
| `adapters/worktree/` | 5 | git-worktree, in-memory, contract spec |
| `adapters/overseer/` | 3 | composable-overseer, in-memory |
| `adapters/guardrails/` | 4+11 | composable-guardrail, in-memory + rules/ (keep existing) |
| `adapters/pause-signal/` | 2 | process-signal + in-memory |
| `policies/` | 4 | default-retry-policy, timeout-strategy |
| `pi/` | 4 | execution extension + tools (keep existing) |

#### review/infrastructure/ (39 files → 10 subfolders)

| Subfolder | Files | Contents |
|---|---|---|
| `repositories/review/` | 3 | sqlite + in-memory review repo |
| `repositories/ship-record/` | 3 | sqlite + in-memory |
| `repositories/completion-record/` | 3 | sqlite + in-memory |
| `repositories/verification/` | 3 | sqlite + in-memory |
| `adapters/review-ui/` | 7 | terminal, plannotator, in-memory, contract, integration |
| `adapters/slice-spec/` | 2 | bead-slice-spec adapter |
| `adapters/executor-query/` | 2 | cached-executor-query |
| `adapters/changed-files/` | 2 | git-changed-files |
| `adapters/audit/` | 2 | pi-audit |
| `adapters/fixer/` | 4 | pi-fixer, stub-fixer |
| `adapters/merge-gate/` | 2 | pi-merge-gate |
| `adapters/milestone/` | 4 | milestone-query, milestone-transition |

#### kernel/agents/ (39 files → 6 subfolders)

| Subfolder | Files | Contents |
|---|---|---|
| `schemas/` | 12 | agent-card, dispatch, event, result, status, turn-metrics schemas |
| `builders/` | 4 | dispatch + result builders |
| `errors/` | 4 | agent-errors, agent-dispatch.error, agent-status-parse.error |
| `services/` | 10 | status-parser, cross-checker, status-prompt, registry, resource-loader, validation, template |
| `ports/` | 1 | agent-dispatch.port |
| `prompts/` | 1 | guardrail-prompt |

Note: `agent-boundary.spec.ts` (E2E) stays at root level as `__tests__/agent-boundary.spec.ts`.

#### review/domain/ (34 flat files → 3 new subfolders)

| Subfolder | Files | Contents |
|---|---|---|
| `aggregates/` | 8 | review, ship-record, completion-record, verification aggregates |
| `value-objects/` | 2 | merged-review VO |
| `schemas/` | 13 | completion, conduct-review, critique-reflection, merged-review, review, review-ui, ship, verification |
| `builders/` | 5 | review, critique-reflection, finding builders |
| `strategies/` | 2 | review-strategy |

Existing subdirs unchanged: `ports/` (14), `errors/` (17), `events/` (7), `services/` (4).

### Critical Update Points

1. **Barrel exports** — each hexagon's `index.ts` needs path updates:
   - `execution/index.ts`: ~46 infrastructure exports
   - `review/index.ts`: ~25 infrastructure exports
   - `kernel/agents/index.ts`: ~100 lines of exports

2. **Cross-hexagon imports** — `src/cli/extension.ts` directly imports 7 files from `execution/infrastructure/`:
   - `GitWorktreeAdapter`, `InMemoryCheckpointRepository`, `InMemoryJournalRepository`
   - `MarkdownExecutionSessionAdapter`, `PiAgentDispatchAdapter`, `ProcessSignalPauseAdapter`
   - `registerExecutionExtension` (from `pi/`)

3. **Path aliases** — `@hexagons/*` and `@kernel/*` aliases in tsconfig.json remain valid (they point to root dirs, not individual files).

### Execution Strategy

Batch moves by hexagon, run full test suite after each batch:
1. Batch 1: `kernel/agents/` (least coupling to other hexagons)
2. Batch 2: `review/domain/` (flat files only, existing subdirs untouched)
3. Batch 3: `review/infrastructure/`
4. Batch 4: `execution/infrastructure/` (most coupling, most risk — do last)

---

## Part B: State Branch Ops — Technical Research

### TFF-CC Reference Patterns (Proven)

#### Orphan Branch Creation (3-step sequence)

```bash
git worktree add --detach <tmpPath>          # detached worktree
git -C <tmpPath> checkout --orphan <branch>  # create orphan branch
git -C <tmpPath> rm -rf --cached .           # clear index (true orphan)
# write files, commit, push (best-effort)
git worktree remove --force <tmpPath>        # cleanup
```

#### Temp Worktree Write (sync flow)

```bash
git worktree add <tmpPath> <stateBranch>     # checkout state branch
# copy files into tmpPath
git -C <tmpPath> add -A
git -C <tmpPath> commit -m "sync: <message>"
git push origin <stateBranch>                # best-effort
git worktree remove <tmpPath>                # always in finally block
```

#### Binary-Safe Read

```typescript
// CRITICAL: Cannot use runGit() — it calls stdout.trim() which corrupts binary data
execFile('git', ['show', `${ref}:${path}`], {
  encoding: 'buffer',   // NOT 'utf-8'
  maxBuffer: 10 * 1024 * 1024,  // 10MB
}, (err, stdout) => {
  // stdout is Buffer, not string
});
```

#### Entity-ID Merge (SQL ATTACH)

```sql
ATTACH DATABASE '<childPath>' AS child;
INSERT OR REPLACE INTO slice (...) SELECT ... FROM child.slice WHERE id = ?;
INSERT OR REPLACE INTO task (...) SELECT ... FROM child.task WHERE slice_id = ?;
DELETE FROM dependency WHERE from_id IN (SELECT id FROM child.task WHERE slice_id = ?);
INSERT INTO dependency (...) SELECT ... FROM child.dependency WHERE from_id IN (SELECT id FROM child.task WHERE slice_id = ?);
DETACH DATABASE child;
```

### TFF-PI Adaptation Notes

**For M07-S01 spike, we use JSON merge instead of SQL ATTACH** (per design decision). The spike validates:

```typescript
// JSON entity-ID merge (simpler than SQL ATTACH, works with state-snapshot.json)
function mergeSnapshots(parent: StateSnapshot, child: StateSnapshot, sliceId: string): StateSnapshot {
  return {
    ...parent,
    slices: mergeById(parent.slices, child.slices, e => e.id === sliceId ? 'child' : 'parent'),
    tasks: mergeById(parent.tasks, child.tasks, e => e.sliceId === sliceId ? 'child' : 'parent'),
    // project + milestones: parent wins (canonical)
  };
}
```

### Existing GitPort in TFF-PI

Already has: `listBranches`, `createBranch`, `deleteBranch`, `showFile` (utf-8 only), `worktreeAdd`, `worktreeRemove`, `worktreeList`, `commit`, `status`, `log`, `diff`, `pushFrom`.

**Missing for StateBranchOpsPort:**
- `createOrphan` — needs the 3-step detach → orphan → rm-cached sequence
- Binary-safe `showFile` — existing returns `string | null`, need `Buffer | null`
- `lsTree` — list all files in a tree (for full read)
- `renameBranch` — `git branch -m`

These go in the new `StateBranchOpsPort` + `GitStateBranchOpsAdapter`, NOT in existing GitPort.

### Key Patterns to Replicate

1. **Clean git env** — strip `GIT_*` vars (already in TFF-PI's `GitCliAdapter`)
2. **Binary-safe extraction** — raw `execFile` with `encoding:'buffer'`
3. **Path traversal protection** — `path.resolve()` check on every extracted file
4. **Try-finally cleanup** — temp worktrees always removed
5. **Best-effort push** — `.catch(() => undefined)` on push
6. **"Nothing to commit" suppression** — not an error

### Key Patterns to Avoid

1. `stdout.trim()` on binary data (corrupts files)
2. GIT_* env leaking to subprocesses (already handled)
3. Deleting branch before worktree (orphans cleanup)
4. Failing on remote push failure
5. Skipping path traversal validation

### Locking

TFF-CC uses `proper-lockfile` (npm package):
- Retry: constant 200ms interval, ceil(timeout/200) attempts
- Stale: 30s (auto-force-acquire if older)
- Returns release function or null

For S01 spike: locking not needed (single-threaded tests). For S02: add `proper-lockfile` dependency.

### Dependencies to Add (S01)

None — all git operations use existing `execFile` from Node.js. `StateBranchOpsPort` has no external dependencies.

For S02 (future): `proper-lockfile` for advisory locking.

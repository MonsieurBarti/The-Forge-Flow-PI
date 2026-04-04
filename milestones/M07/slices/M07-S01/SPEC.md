# M07-S01: Infrastructure Reorg + State Branch Ops Spike

## Problem

Two problems addressed in one slice:

1. **Crowded directories.** `execution/infrastructure/` has 40 files, `review/infrastructure/` 39, `kernel/agents/` 39, `review/domain/` 30. Finding files is difficult; M07 will add more files to these directories (state sync adapters, new ports). Must reorganize before adding more.

2. **Unvalidated state branch mechanism.** The state persistence design requires writing to orphan branches via temp worktrees and reading via git plumbing. This has never been tested in this codebase. Need a spike to validate the full round-trip before building real infrastructure on top of it.

## Approach

**Part A first (reorg), then Part B (spike).** The reorg creates clean directory structure that Part B's new files land into.

### Part A: Infrastructure Reorganization

Reorganize directories with 25+ files into port/adapter-paired subfolders. Each port gets a subfolder containing its adapter(s), mock(s), and contract test. No logic changes — mechanical file moves + import updates.

**Directories to reorganize:**

| Directory | Current | Target subfolders |
|---|---|---|
| `execution/infrastructure/` | 40 files flat | `checkpoint/`, `journal/`, `metrics/`, `agent-dispatch/`, `worktree/`, `overseer/`, `guardrails/`, `rules/` (exists) |
| `review/infrastructure/` | 39 files flat | `review/`, `ship-record/`, `completion-record/`, `review-dispatch/`, `executor-query/`, `review-ui/` |
| `kernel/agents/` | 39 files flat | `schemas/`, `dispatch/`, `status/`, `services/` (no identity files here — those are in `src/resources/agents/`) |
| `review/domain/` | 30 files flat | `aggregates/`, `value-objects/` (ports/, events/, errors/, services/ already exist) |

### Part B: State Branch Ops Spike

Create `StateBranchOpsPort` in `kernel/ports/` and `GitStateBranchOpsAdapter` in `kernel/infrastructure/state-branch/` (follows existing kernel infrastructure pattern). Validate full lifecycle:

1. Create orphan state branch (`git checkout --orphan` + initial commit)
2. Write directory tree via temp worktree (`git worktree add` → copy files → `git add -A && commit` → `git worktree remove`)
3. Read back via `git show <branch>:<path>` with `encoding:'buffer'` (binary-safe)
4. Verify byte-for-byte identical content
5. Fork child branch via `git branch` (ref copy, no checkout)
6. Modify child, verify parent unchanged
7. Programmatic merge: read both JSON snapshots, merge by entity ID, write merged result to parent
8. Verify merged state is correct

**StateBranchOpsPort interface:**

```typescript
export abstract class StateBranchOpsPort {
  abstract createOrphan(branchName: string): Promise<Result<void, GitError>>;
  abstract forkBranch(source: string, target: string): Promise<Result<void, GitError>>;
  abstract deleteBranch(branchName: string): Promise<Result<void, GitError>>;
  abstract branchExists(branchName: string): Promise<Result<boolean, GitError>>;
  abstract renameBranch(oldName: string, newName: string): Promise<Result<void, GitError>>;
  abstract syncToStateBranch(stateBranch: string, files: Map<string, Buffer>): Promise<Result<string, GitError>>; // returns commit SHA
  abstract readFromStateBranch(stateBranch: string, path: string): Promise<Result<Buffer | null, GitError>>;
  abstract readAllFromStateBranch(stateBranch: string): Promise<Result<Map<string, Buffer>, GitError>>;
}
```

## Constraints

- Part A: zero logic changes — only file moves + import updates
- Part A: all existing tests must pass after reorg
- Part B: operations must not touch the working tree (no checkout to state branches)
- Part B: reads must be binary-safe (`encoding:'buffer'` — critical for future SQLite/JSON handling)
- Part B: temp worktree cleanup must happen in finally blocks (crash-safe)
- `StateBranchOpsPort` is a NEW port in kernel, separate from `GitPort` (different concern boundary)

## Acceptance Criteria

- AC1: No flat directory has 15+ files (including tests) after reorg
- AC2: All existing tests pass after reorg (zero regressions)
- AC3: Full round-trip (write → read → verify) passes for state branch ops
- AC4: Fork produces independent branch (modifications don't affect parent)
- AC5: Entity-ID JSON merge produces correct merged state
- AC6: Temp worktree used for writes; reads use git show (binary-safe)
- AC7: `StateBranchOpsPort` defined in kernel with all required methods
- AC8: `GitStateBranchOpsAdapter` has full test coverage (unit + integration)

## Non-Goals

- Real StateSyncPort implementation (that's S02)
- State snapshot schema or BranchMeta schema (S02)
- Post-checkout hook (S03)
- Any workflow changes (S04)
- Optimizing performance of git operations

## Risks

| Risk | Mitigation |
|---|---|
| Import path changes break things | Run full test suite after each batch of moves. Use IDE refactor tools where possible. |
| Barrel exports need updating | Update each hexagon's `index.ts` barrel after moves |
| Temp worktree creation fails in CI or constrained environments | Test in local environment first; document requirements |
| Binary-safe reads miss edge cases | Follow TFF-CC's proven pattern: raw `execFile` with `encoding:'buffer'`, no stdout.trim() |

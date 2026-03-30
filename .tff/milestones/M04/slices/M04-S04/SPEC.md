# M04-S04: Worktree Management

## Problem

The execution engine dispatches agents to work on slice tasks in parallel. Each agent needs an isolated copy of the repository to avoid conflicts. Git worktrees provide this isolation — one worktree per slice, created during planning and destroyed after ship/merge. Without managed worktrees, parallel agents would corrupt each other's working tree.

## Approach

**Port + Use Case**: `WorktreePort` defines CRUD + validate operations (all I/O). Cleanup logic lives in `CleanupOrphanedWorktreesUseCase` that cross-references worktree state with slice status. `GitPort` (kernel) is extended with worktree + branch-delete methods to keep all git operations behind a single abstraction. The adapter composes `GitPort` — no direct shell-outs.

> **Design spec divergence**: Supersedes design spec's raw-git-params `WorktreePort(branch, baseBranch, path)` with a slice-oriented abstraction using `sliceId` as key. Convention mapping (sliceId -> branch/path) is computed internally by the adapter, raising the abstraction level and using domain-specific `WorktreeError` instead of raw `GitError`.

### Trade-offs Considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Port + Use Case | Clean separation: port = I/O, use case = logic. Follows existing patterns (RollbackSliceUseCase) | Slightly more files | **Selected** |
| Rich Port | Fewer files | Mixes I/O w/ business logic in adapter | Rejected |
| Domain Service | Port stays minimal | Extra layer for simple logic | Rejected |

## Design

### Schemas & Types

**`worktree.schemas.ts`** (execution/domain/)

```typescript
WorktreeInfoSchema = z.object({
  sliceId:    IdSchema,
  branch:     z.string(),     // "slice/M04-S04"
  path:       z.string(),     // abs path to worktree dir
  baseBranch: z.string(),     // "milestone/M04"
})

WorktreeHealthSchema = z.object({
  sliceId:     IdSchema,
  exists:      z.boolean(),   // dir exists on disk
  branchValid: z.boolean(),   // branch ref exists in git
  clean:       z.boolean(),   // no uncommitted changes
  reachable:   z.boolean(),   // base branch is ancestor
})

CleanupReportSchema = z.object({
  deleted: z.array(z.string()),
  skipped: z.array(z.string()),
  errors:  z.array(z.object({ sliceId: z.string(), reason: z.string() })),
})
```

### Errors

**`worktree.errors.ts`** (execution/domain/) — extends `BaseDomainError`

- `.creationFailed(sliceId, cause)` — git worktree add failed
- `.deletionFailed(sliceId, cause)` — git worktree remove failed
- `.notFound(sliceId)` — no worktree for this slice (callers use this to enforce F-tier blocking)
- `.alreadyExists(sliceId)` — worktree already created
- `.unhealthy(sliceId, health)` — validation found issues
- `.branchConflict(sliceId, branch)` — branch already in use

### WorktreePort

**`worktree.port.ts`** (execution/domain/ports/)

```typescript
export abstract class WorktreePort {
  abstract create(sliceId: string, baseBranch: string): Promise<Result<WorktreeInfo, WorktreeError>>;
  abstract delete(sliceId: string): Promise<Result<void, WorktreeError>>;
  abstract list(): Promise<Result<WorktreeInfo[], WorktreeError>>;
  abstract exists(sliceId: string): Promise<boolean>;
  abstract validate(sliceId: string): Promise<Result<WorktreeHealth, WorktreeError>>;
}
```

Convention mapping (computed by adapter, not passed by caller):
- `sliceId: "M04-S04"` -> branch: `"slice/M04-S04"`, path: `<projectRoot>/.tff/worktrees/M04-S04/`

### GitPort Extension

**`git.port.ts`** (kernel/ports/) — add 5 methods + schema:

```typescript
// Worktree operations
// worktreeAdd uses `git worktree add -b <branch> <path> <baseBranch>` (fail-safe -b, NOT -B).
// If branch already exists → GitError. Caller should delete() first to recreate.
abstract worktreeAdd(path: string, branch: string, baseBranch: string): Promise<Result<void, GitError>>;
// worktreeRemove uses `git worktree remove --force <path>` to handle unclean worktrees
// (agents may crash leaving modified files). Forced removal is safe because worktrees
// are only deleted for closed slices (post-merge) or via explicit user action.
abstract worktreeRemove(path: string): Promise<Result<void, GitError>>;
abstract worktreeList(): Promise<Result<GitWorktreeEntry[], GitError>>;

// Branch cleanup — force: false by default (refuses to delete unmerged branches).
// Cleanup use case only targets closed slices (post-merge), so force=false is safe.
// If branch has unmerged work → GitError propagated as WorktreeError.deletionFailed.
abstract deleteBranch(name: string, force?: boolean): Promise<Result<void, GitError>>;

// Worktree-scoped status (runs git -C <cwd> status)
abstract statusAt(cwd: string): Promise<Result<GitStatus, GitError>>;

GitWorktreeEntrySchema = z.object({
  path:   z.string(),
  branch: z.string().optional(),
  head:   z.string(),
  bare:   z.boolean(),
})
```

**Notes:**
- `statusAt(cwd)` is required because `validate()` must check for uncommitted changes inside a worktree's working directory, which has its own index separate from the main repo.
- `worktreeList` porcelain output format: records separated by blank lines, fields: `worktree <path>`, `HEAD <sha>`, `branch refs/heads/<name>` (optional for detached), `bare` (flag). Adapter must handle optional fields.
- Adding 5 abstract methods to `GitPort` will break existing mocks (e.g., `MockGitPort` in `rollback-slice.use-case.spec.ts`). All existing `extends GitPort` mocks must be updated with stub implementations of the new methods.

### Adapters

**`git-worktree.adapter.ts`** (execution/infrastructure/)

`GitWorktreeAdapter extends WorktreePort`
- Constructor: `(gitPort: GitPort, projectRoot: string)`
- `create()`: derive branch/path, call `gitPort.worktreeAdd()` (uses `-b`, fail-safe), return `WorktreeInfo`. If branch already exists → `alreadyExists` error.
- `delete()`: derive path, call `gitPort.worktreeRemove()` (`--force` for unclean worktrees), then `gitPort.deleteBranch(name, false)`. If branch unmerged → `deletionFailed` error (worktree already removed at this point; branch preserved for manual recovery).
- `list()`: call `gitPort.worktreeList()`, filter `.tff/worktrees/` entries using path normalization (`path.resolve()`) to handle macOS symlink differences (e.g., `/var` vs `/private/var`), map to `WorktreeInfo[]`
- `exists()`: call `list()`, check presence
- `validate()`: `fs.access(path)` for disk check (adapter-level concern, not a port method — in-memory adapter returns `exists: true` for stored entries) + `gitPort.listBranches(branch)` + `gitPort.statusAt(worktreePath)` for clean check + `gitPort.isAncestor()` for reachability

**`in-memory-worktree.adapter.ts`** (execution/infrastructure/)

`InMemoryWorktreeAdapter extends WorktreePort`
- `Map<string, WorktreeInfo>` store
- `seed()` and `reset()` for test setup
- No filesystem, pure map operations

### SliceStatusProvider

**`slice-status-provider.port.ts`** (execution/domain/ports/) — narrow cross-hexagon interface

```typescript
export interface SliceStatusProvider {
  getStatus(sliceId: string): Promise<Result<SliceStatus, Error>>;
}
```

Owned by execution hexagon. `SliceStatus` type imported from slice hexagon's barrel export (`src/hexagons/slice/index.ts`) — allowed per architectural rules (hexagons may import from other hexagons' barrel exports). Implementation adapter wraps the slice hexagon's repository — wired in a later integration slice. For this slice, tests use a stub implementation. Only the literal `"closed"` status triggers cleanup deletion (not `"completing"`).

### CleanupOrphanedWorktreesUseCase

**`cleanup-orphaned-worktrees.use-case.ts`** (execution/application/)

```typescript
export class CleanupOrphanedWorktreesUseCase {
  constructor(
    worktreePort: WorktreePort,
    sliceStatusProvider: SliceStatusProvider
  )
  execute(): Promise<Result<CleanupReport, WorktreeError>>
}
```

Algorithm:
1. `worktreePort.list()` -> all active worktrees
2. `forall` worktree: `sliceStatusProvider.getStatus(sliceId)`
3. If `getStatus()` errors or slice not found -> add to `skipped` (safe default)
4. If slice closed -> `worktreePort.delete(sliceId)`
5. Return `CleanupReport`

### File Layout

```
src/kernel/ports/git.port.ts                                              (extend)
src/hexagons/execution/domain/worktree.schemas.ts                         (new)
src/hexagons/execution/domain/worktree.errors.ts                          (new)
src/hexagons/execution/domain/ports/worktree.port.ts                      (new)
src/hexagons/execution/domain/ports/slice-status-provider.port.ts         (new)
src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.ts (new)
src/hexagons/execution/infrastructure/git-worktree.adapter.ts             (new)
src/hexagons/execution/infrastructure/in-memory-worktree.adapter.ts       (new)
src/hexagons/execution/infrastructure/worktree.contract.spec.ts           (new)
src/hexagons/execution/index.ts                                           (extend barrel)
```

## Acceptance Criteria

1. `WorktreePort.create()` creates git worktree at `.tff/worktrees/<sliceId>/` on branch `slice/<sliceId>`
2. `WorktreePort.delete()` removes worktree from disk and deletes the slice branch
3. `WorktreePort.exists()` returns false after deletion
4. `WorktreePort.validate()` detects: missing dirs, invalid branches, uncommitted changes, unreachable base
5. `CleanupOrphanedWorktreesUseCase` deletes worktrees for closed slices, leaves active ones, skips on status-lookup failure
6. Missing worktree for lookup produces `WorktreeError.notFound` — callers use this to enforce F-lite/F-full blocking (R04-d)
7. Creating duplicate worktree produces `WorktreeError.alreadyExists`
8. GitPort extended with `worktreeAdd/worktreeRemove/worktreeList/deleteBranch/statusAt` — existing tests still pass
9. In-memory adapter passes same contract tests as git adapter (`worktree.contract.spec.ts`)

## Non-Goals

- No per-task worktree management (per-slice only)
- No S-tier worktree logic (S-tier runs in main repo, enforced by caller not this port)
- No integration with wave-based execution engine (S07)
- No automatic worktree creation during plan phase (wiring comes when plan workflow integrates)
- No SliceStatusProvider real adapter (stub only — real adapter wired in integration slice)

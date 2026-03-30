# M04-S04 Worktree Management — Research

## 1. GitPort Extension Impact Analysis

### Current GitPort (8 abstract methods)
**File**: `src/kernel/ports/git.port.ts` (L5-14)

```
listBranches, createBranch, showFile, log, status, commit, revert, isAncestor
```

### All `extends GitPort` sites (exhaustive)

| # | File | Line | Class | Role |
|---|------|------|-------|------|
| 1 | `src/kernel/infrastructure/git-cli.adapter.ts` | L14 | `GitCliAdapter` | Production adapter |
| 2 | `src/hexagons/execution/application/rollback-slice.use-case.spec.ts` | L14 | `MockGitPort` | Test mock |

No other classes extend or implement `GitPort` anywhere in the codebase.

### Required changes per site

**`GitCliAdapter`** (L14, `src/kernel/infrastructure/git-cli.adapter.ts`):
- Must implement 5 new methods: `worktreeAdd`, `worktreeRemove`, `worktreeList`, `deleteBranch`, `statusAt`
- `runGit` (L27) uses `{ cwd: this.cwd }` — `statusAt(cwd)` needs either a new `runGitAt(cwd, args)` helper or must pass `["-C", cwd, ...]` args. The `-C` approach is cleaner since it avoids duplicating the `runGit` wrapper. However, the existing `runGit` prepends `["--no-pager", "-c", "color.ui=never"]` which need to come before `-C`. Recommendation: add a private `runGitAt(cwd: string, args: string[])` that constructs `["-C", cwd, ...args]` and delegates to `runGit`, or create a variant that overrides cwd in execFile options.
- `worktreeList` must parse porcelain format (see Section 2)
- `mapError` (L44) may need additional patterns for worktree-specific errors (e.g., `"already exists"`, `"is not a working tree"`, `"already checked out"`)

**`MockGitPort`** (L14-54, `rollback-slice.use-case.spec.ts`):
- Must add 5 stub methods returning default ok values
- Current mock pattern: each unused method returns a trivial ok (e.g., `listBranches` -> `ok([])`, `status` -> `ok({...})`)
- Stubs needed:
  - `worktreeAdd() -> ok(undefined)`
  - `worktreeRemove() -> ok(undefined)`
  - `worktreeList() -> ok([])`
  - `deleteBranch() -> ok(undefined)`
  - `statusAt() -> ok({ branch: "test", clean: true, entries: [] })`

### Files that must be updated (complete list)

1. `src/kernel/ports/git.port.ts` — add 5 abstract methods + `GitWorktreeEntrySchema`
2. `src/kernel/ports/git.schemas.ts` — add `GitWorktreeEntrySchema` and `GitWorktreeEntry` type (or put in git.port.ts per spec)
3. `src/kernel/infrastructure/git-cli.adapter.ts` — implement 5 new methods
4. `src/hexagons/execution/application/rollback-slice.use-case.spec.ts` — add 5 stubs to `MockGitPort`
5. `src/kernel/ports/index.ts` — export new schema/type if placed in git.schemas.ts
6. `src/kernel/index.ts` — export new schema/type from barrel

---

## 2. Git Worktree CLI Behavior

### `git worktree add -b <branch> <path> <base>`

| Scenario | Behavior | Exit Code |
|----------|----------|-----------|
| Happy path (new branch, new/empty path) | Creates worktree, creates branch from base, checks out | 0 |
| Branch already exists (`-b` not `-B`) | `fatal: a branch named '<branch>' already exists` | 255 |
| Path is existing empty directory | Succeeds (reuses empty dir) | 0 |
| Path is existing non-empty directory | `fatal: '<path>' already exists` | 128 |
| Path does not exist | Creates directory and worktree | 0 |
| Base ref does not exist | `fatal: not a valid object name` | 128 |

Key distinction: `-b` (lowercase) fails if branch exists. `-B` (uppercase) force-resets existing branch. The spec mandates `-b` (fail-safe).

### `git worktree remove --force <path>`

| Scenario | Behavior | Exit Code |
|----------|----------|-----------|
| Clean worktree | Removes dir and unlinks from git | 0 |
| Unclean worktree (modified/untracked files), no --force | `fatal: '<path>' contains modified or untracked files, use --force to delete it` | 128 |
| Unclean worktree, --force | Removes dir and unlinks (untracked files deleted) | 0 |
| Path doesn't exist (never was a worktree) | `fatal: '<path>' is not a working tree` | 128 |
| Dir manually deleted but git still tracks it (stale) | Succeeds — removes git's administrative reference | 0 |
| Locked worktree, single --force | Refuses. Needs `--force --force` (double force) | 128 |

`--force` handles untracked files: YES. It removes the entire directory regardless of content.

### `git worktree list --porcelain`

Format: records separated by blank lines. Each record starts with `worktree <path>`.

**Main worktree example:**
```
worktree /Users/pierrelecorff/Projects/The-Forge-Flow-PI
HEAD 96742d8f76817fadaaacc0d110df3321518e45ee
branch refs/heads/milestone/M04

```

**Linked worktree example:**
```
worktree /Users/pierrelecorff/Projects/The-Forge-Flow-PI/M03-S08
HEAD c62d18b4895eea34cd1c7ce1fa4d57bf798030f1
branch refs/heads/M03-S08
prunable gitdir file points to non-existent location

```

**Bare repo example:**
```
worktree /private/tmp/test-wt-research/bare-repo
bare

```

**Detached HEAD example** (from docs):
```
worktree /path/to/other-linked-worktree
HEAD 1234abc1234abc1234abc1234abc1234abc1234a
detached

```

Field rules:
- `worktree <path>` — always first, always present
- `HEAD <sha>` — present for non-bare
- `branch refs/heads/<name>` — present only when on a branch (absent when detached)
- `bare` — boolean flag, present only for bare repos
- `detached` — boolean flag, present when HEAD is detached
- `locked [reason]` — optional, with optional reason string
- `prunable <reason>` — optional
- Records terminated by blank line

### macOS symlink path issue

On macOS, `/var` -> `/private/var` and `/tmp` -> `/private/tmp`. Git porcelain output uses **resolved (real) paths**. Example: creating a worktree at `/tmp/foo` shows as `/private/tmp/foo` in `git worktree list --porcelain`. This means path comparison in the adapter MUST use `path.resolve()` or `fs.realpath()` to normalize before comparing. The spec explicitly calls this out: "filter `.tff/worktrees/` entries using path normalization (`path.resolve()`)".

---

## 3. Existing Adapter Patterns

### Constructor patterns

**`MarkdownCheckpointRepository`** (`src/hexagons/execution/infrastructure/markdown-checkpoint.repository.ts`, L12-19):
- `constructor(basePath: string, resolveSlicePath: (sliceId) => Promise<Result<string, PersistenceError>>)`
- Calls `super()` (extends abstract port class)
- Dependencies are plain values + function, not ports

**`InMemoryAgentDispatchAdapter`** (`src/hexagons/execution/infrastructure/in-memory-agent-dispatch.adapter.ts`, L11):
- No constructor args — all state is internal Maps
- Extends `AgentDispatchPort` abstract class
- Has `givenResult()`, `givenDelayedResult()`, `reset()` for test configuration

**`GitCliAdapter`** (`src/kernel/infrastructure/git-cli.adapter.ts`, L14-17):
- `constructor(private readonly cwd: string)` — single string dependency
- Calls `super()`

Pattern: constructors take either primitives (paths, strings) or injected ports. The `GitWorktreeAdapter` taking `(gitPort: GitPort, projectRoot: string)` fits this pattern perfectly.

### Error handling (Result type wrapping)

All adapters use the `Result<T, E>` pattern from `@kernel`:
- `ok(value)` for success
- `err(new SomeError(...))` for failure
- Never throw — all errors are returned as `Result.err`
- `isErrnoException(error)` type guard for filesystem errors (see `markdown-checkpoint.repository.ts` L8-10)
- `try/catch` only around I/O calls, immediately wrapped into Result

### In-memory adapter pattern

All in-memory adapters follow the same structure:
1. `Map<string, T>` as private store
2. `seed(...)` method for test pre-population
3. `reset()` method that calls `this.store.clear()`
4. No constructor args (stateless start)
5. All methods return `ok(...)` — never produce errors in happy path

The `InMemoryWorktreeAdapter` should follow this: `Map<string, WorktreeInfo>` store, `seed()`, `reset()`.

### Contract test pattern

Three contract test files exist:

| File | Export | Signature |
|------|--------|-----------|
| `checkpoint-repository.contract.spec.ts` | `runContractTests(name, factory)` | `factory: () => Port & { reset(): void }` |
| `journal-repository.contract.spec.ts` | `runJournalContractTests(name, factory)` | `factory: () => Port & { reset(): void }` |
| `agent-dispatch.contract.spec.ts` | `runContractTests(name, factory, options?)` | `factory: () => { adapter, configurator }` |

**Structure:**
1. Contract file exports a `runContractTests` / `runJournalContractTests` function
2. Function takes `name: string` and a `factory` function
3. Factory returns adapter instance (with `reset()` method)
4. `beforeEach` calls `factory()` and `reset()`
5. Tests cover behavioral contracts (roundtrip, idempotency, ordering)

**Wiring in individual spec files:**
- `in-memory-checkpoint.repository.spec.ts` (L7): `runContractTests("InMemoryCheckpointRepository", () => new InMemoryCheckpointRepository())`
- `markdown-checkpoint.repository.spec.ts` (L30-33): `runContractTests("MarkdownCheckpointRepository", () => { ... })`
- Adapter-specific tests follow in a separate `describe` block in the same file

**Parameterization**: each adapter's `.spec.ts` imports the contract function and calls it with its own factory. No vitest parameterization — just function calls.

The `agent-dispatch.contract.spec.ts` (L27-31) adds a more complex pattern with a `TestConfigurator` interface and optional `skip` list for tests that don't apply to all adapters. The worktree contract tests will likely follow the simpler checkpoint/journal pattern since both adapters (in-memory + git) should pass all tests.

---

## 4. Barrel Export Pattern

**File**: `src/hexagons/execution/index.ts` (53 lines)

### Current export structure

```
// Domain -- Schemas          (types + runtime schemas)
// Application -- Use Cases   (classes + types)
// Domain -- Errors           (error classes)
// Domain -- Events           (event classes)
// Domain -- Ports            (abstract port classes)
// Infrastructure -- Adapters (concrete adapter classes)
```

### What gets exported

| Category | Exported? | Examples |
|----------|-----------|---------|
| Domain schemas (types) | YES (type exports) | `CheckpointDTO`, `CheckpointProps`, `ExecutorLogEntry` |
| Domain schemas (runtime) | YES | `CheckpointPropsSchema`, `ExecutorLogEntrySchema` |
| Domain errors | YES | `AgentDispatchError`, `RollbackError`, etc. |
| Domain events | YES | `CheckpointSavedEvent` |
| Domain ports (abstract) | YES | `AgentDispatchPort`, `CheckpointRepositoryPort`, `JournalRepositoryPort`, `PhaseTransitionPort` |
| Application use cases | YES | `RollbackSliceUseCase`, `ReplayJournalUseCase`, `JournalEventHandler` |
| Infrastructure adapters | YES | `InMemoryCheckpointRepository`, `InMemoryJournalRepository`, `InMemoryAgentDispatchAdapter`, `PiAgentDispatchAdapter` |
| Builders | NO (not in barrel) | `CheckpointBuilder`, `JournalEntryBuilder` — used only internally by tests |

### What M04-S04 must add to the barrel

- `WorktreeInfo`, `WorktreeHealth`, `CleanupReport` types (from `worktree.schemas.ts`)
- `WorktreeInfoSchema`, `WorktreeHealthSchema`, `CleanupReportSchema` (runtime schemas)
- `WorktreeError` (from `worktree.errors.ts`)
- `WorktreePort` (from `worktree.port.ts`)
- `SliceStatusProvider` interface (from `slice-status-provider.port.ts`)
- `CleanupOrphanedWorktreesUseCase` (from application)
- `GitWorktreeAdapter` (from infrastructure)
- `InMemoryWorktreeAdapter` (from infrastructure)

---

## 5. Cross-Hexagon Dependencies

### SliceStatus type

**Defined at**: `src/hexagons/slice/domain/slice.schemas.ts` (L5-15)

```typescript
export const SliceStatusSchema = z.enum([
  "discussing", "researching", "planning", "executing",
  "verifying", "reviewing", "completing", "closed",
]);
export type SliceStatus = z.infer<typeof SliceStatusSchema>;
```

**Exported from barrel**: `src/hexagons/slice/index.ts` (L6-13)
- `SliceStatus` exported as **type** (L13): `SliceDTO, SliceStatus` in the `export type { ... }` block
- `SliceStatusSchema` exported as **value** (L19): `SliceStatusSchema` in the `export { ... }` block

**Import path for execution hexagon**:
```typescript
import type { SliceStatus } from "@hexagons/slice";
// or: import type { SliceStatus } from "../../slice";
```

Depends on tsconfig path aliases. The barrel at `src/hexagons/slice/index.ts` is the correct entry point per hexagonal architecture rules. Verified: the type exists and is exported.

---

## 6. Path Resolution on macOS

### Current codebase usage

**No `path.resolve()` or `path.normalize()` calls exist anywhere in `src/`.**

The grep for `path\.resolve|path\.normalize` returned zero matches. The codebase currently uses `join()` from `node:path` (e.g., `markdown-checkpoint.repository.ts` L3, `jsonl-journal.repository.spec.ts` L3) but never resolves or normalizes.

### GitCliAdapter path handling

`GitCliAdapter` (`src/kernel/infrastructure/git-cli.adapter.ts`):
- Constructor takes `cwd: string` (L15) — stored as-is, no normalization
- `runGit` passes `cwd` directly to `execFile` options (L32)
- No path resolution anywhere

### Implications for worktree adapter

The `GitWorktreeAdapter` will be the FIRST code in the codebase to use `path.resolve()`. This is needed because:
1. `git worktree list --porcelain` returns real/resolved paths (e.g., `/private/tmp/...` not `/tmp/...`)
2. `projectRoot` passed to the adapter constructor might be unresolved
3. Path comparison (filtering `.tff/worktrees/` entries) requires both sides normalized

Recommendation: use `path.resolve()` on both `projectRoot` (at construction time) and on paths from porcelain output before comparison. `path.resolve()` is sufficient on macOS — no need for `fs.realpath()` unless dealing with custom symlinks beyond the standard `/var`->`/private/var` mapping.

---

## 7. .gitignore Verification

**File**: `.gitignore` (13 lines)

`.tff/worktrees/` is listed on **line 13**. Confirmed present.

Full relevant entries:
```
.tff/worktrees/
```

No other `.tff/` subdirectories are gitignored (`.tff/milestones/` etc. are tracked). This is correct — worktree directories should never be committed.

---

## Risks and Mitigations

### R1: GitPort extension breaks all subclasses (HIGH)
- **Risk**: Adding 5 abstract methods to `GitPort` will cause TypeScript compilation errors in `GitCliAdapter` and `MockGitPort` until they implement the new methods.
- **Mitigation**: Update all 3 files (`git.port.ts`, `git-cli.adapter.ts`, `rollback-slice.use-case.spec.ts`) in a single commit. There are exactly 2 subclasses — both identified and analyzed above.

### R2: macOS path mismatch in worktree list filtering (HIGH)
- **Risk**: `git worktree list --porcelain` returns `/private/...` resolved paths. If `projectRoot` is `/Users/.../project` (no symlinks), but someone uses `/tmp/...` as a worktree path, the `/private/tmp` prefix won't match.
- **Mitigation**: The spec places worktrees under `.tff/worktrees/` relative to `projectRoot` (which is in `/Users/...`, not `/tmp`). So for production use, symlink divergence is unlikely. However, **integration tests using `mkdtemp(tmpdir())` will hit this** — `tmpdir()` returns `/var/folders/...` which resolves to `/private/var/folders/...`. Use `path.resolve(fs.realpathSync(tmpdir()))` in tests, or normalize both sides with `path.resolve()`.

### R3: `statusAt(cwd)` implementation complexity (MEDIUM)
- **Risk**: The existing `runGit` method hardcodes `{ cwd: this.cwd }`. `statusAt` needs a different cwd.
- **Mitigation**: Two approaches: (a) Add `runGitAt(cwd, args)` private method, or (b) use `git -C <cwd> status` via regular `runGit`. Approach (b) is simpler — just prepend `["-C", cwd]` before the status args. However, `runGit` already prepends `["--no-pager", "-c", "color.ui=never"]` which must come before `-C`. Since `runGit` constructs `["--no-pager", "-c", "color.ui=never", ...args]`, passing `args = ["-C", cwd, "status", "--porcelain=v1", "--branch"]` works correctly because git global flags precede `-C`.

### R4: Branch delete while worktree still exists (MEDIUM)
- **Risk**: `git branch -d <branch>` fails with `error: cannot delete branch used by worktree` if the worktree still references it (exit code 1).
- **Mitigation**: The spec's `delete()` flow is: `worktreeRemove` first, then `deleteBranch`. This ordering is correct. The adapter must ensure worktree removal succeeds before attempting branch delete. If worktree removal fails, branch delete should be skipped.

### R5: `worktree add -b` with existing empty directory succeeds (LOW)
- **Risk**: If `.tff/worktrees/M04-S04/` exists but is empty (e.g., from a previous failed cleanup), `git worktree add -b` will succeed, but the branch will fail if it already exists.
- **Mitigation**: The `alreadyExists` error is triggered when the branch already exists (exit code 255). The adapter should map the "branch already exists" stderr message to `WorktreeError.alreadyExists`. The empty-dir case is actually benign.

### R6: Porcelain parsing robustness (LOW)
- **Risk**: Optional fields (`branch`, `bare`, `detached`, `locked`, `prunable`) vary per entry. A naive line-by-line parser could break.
- **Mitigation**: Parse record-by-record (split on `\n\n`), then parse fields within each record. Use the `worktree` line as record anchor. Handle missing `branch` (detached HEAD case) by setting branch to `undefined` in `GitWorktreeEntry`.

### R7: Contract test for `GitWorktreeAdapter` needs real git operations (LOW)
- **Risk**: The git-backed adapter's contract tests need a real git repo, which means filesystem setup/teardown.
- **Mitigation**: Follow the `markdown-checkpoint.repository.spec.ts` pattern: `mkdtemp` in `beforeAll`, `rm` in `afterAll`. For the git adapter specifically, initialize a test repo with `git init` and at least one commit. The in-memory adapter needs no such setup. Both share the same contract test function.

# M02-S05: Git CLI Adapter

## Problem

The `GitPort` abstract class defines 6 git operations needed by the TFF workflow engine, but no concrete implementation exists. The system needs a CLI-based adapter that shells out to `git` and returns typed `Result<T, GitError>` values.

## Approach

**Shared `runGit` helper** -- a private method wrapping `node:child_process/execFile` that handles:
- Argument passing as array (no shell injection)
- Working directory scoping via `cwd`
- Exit code and stderr-based error mapping to `GitError`

Each port method calls `runGit` with specific args and parses stdout into domain types.

## Design

### Adapter Class

```
GitCliAdapter extends GitPort
  constructor(cwd: string)
  private runGit(args: string[]): Promise<Result<string, GitError>>
  private mapError(error, stderr): GitError
```

- Uses `execFile` (not `exec`) -- args passed as array, no shell interpretation
- `cwd` injected at construction, passed to every `execFile` call
- macOS/Linux only (no Windows path handling)

### Method Implementations

| Method | Git Command | Output Parsing |
|---|---|---|
| `listBranches(pattern)` | `git branch --list <pattern> --format=%(refname:short)` | Split newlines, filter empty |
| `createBranch(name, base)` | `git branch <name> <base>` | Void on success |
| `showFile(branch, path)` | `git show <branch>:<path>` | Raw stdout; null if "does not exist" |
| `log(branch, limit?)` | `git log <branch> --format=%H%n%s%n%an%n%aI -n <limit>` | Parse 4-line groups into GitLogEntry[] |
| `status()` | `git status --porcelain=v1 --branch` | Parse branch line + porcelain entries |
| `commit(message, paths)` | `git add <paths...>` then `git commit -m <message>` | Extract hash from `[branch hash]` output |

### Status Parsing (porcelain v1)

`git status --porcelain=v1 --branch` output:
- First line: `## <branch>...tracking` (or `## HEAD (no branch)` for detached HEAD)
- Subsequent lines: `XY <path>` where X = index status, Y = working tree status

Porcelain code to `GitFileStatus` mapping:

| XY Pattern | GitFileStatus |
|---|---|
| `??` | `untracked` |
| `A_` (A + space) | `added` |
| `M_` or `_M` | `modified` |
| `D_` or `_D` | `deleted` |
| `R_` | `renamed` |
| `!!` | skip (ignored files) |

Precedence: first non-space column wins. Conflict markers (`DD`, `UU`, etc.) produce `GIT.COMMAND_FAILED` error.

Renamed files: porcelain v1 outputs `R  old-path -> new-path`. Extract **new path** only (strip `old-path -> ` prefix).

Detached HEAD: parse branch as `"HEAD"` literal.

### Log Parsing

Uses `--format=%H%n%s%n%an%n%aI` producing 4-line groups. Each group is parsed through `GitLogEntrySchema.parse()` for Zod validation. Malformed output from git produces a `GIT.COMMAND_FAILED` error via caught ZodError.

### Commit Semantics

- Empty `paths` array: return `err(new GitError('COMMAND_FAILED', 'No paths to commit'))`
- Staging: `git add <paths...>` then `git commit -m <message>`
- No staging rollback on commit failure (git's default behavior)
- Returns **short hash** extracted from git output `[branch short-hash]`
- Root commit variant: `[branch (root-commit) short-hash]` -- regex must handle both formats

### Error Mapping

| Condition | GitError Code |
|---|---|
| git binary not found (ENOENT) | `GIT.NOT_FOUND` |
| "not a git repository" | `GIT.NOT_A_REPO` |
| "did not match any" / "unknown revision" / "does not exist" | `GIT.REF_NOT_FOUND` |
| "CONFLICT" / "conflict" | `GIT.CONFLICT` |
| Any other failure | `GIT.COMMAND_FAILED` |

### showFile Special Case

When `git show` fails with "does not exist" (file missing in tree), return `ok(null)` instead of an error -- this matches the port contract where null means "file not found in that ref".

## File Layout

| File | Purpose |
|---|---|
| `src/kernel/infrastructure/git-cli.adapter.ts` | Adapter implementation |
| `src/kernel/infrastructure/git-cli.adapter.integration.spec.ts` | Integration tests against real git repo |
| `src/kernel/infrastructure/index.ts` | Barrel export update |
| `src/kernel/index.ts` | Top-level barrel export update |

## Integration Test Strategy

- **Setup**: `beforeAll` creates temp directory via `mkdtemp`, runs `git init --initial-branch=main`, configures `user.name` and `user.email` locally, creates initial commit
- **Teardown**: `afterAll` removes temp directory
- **Reset**: `beforeEach` resets repo to initial state (checkout + clean)
- **No mocks**: All tests run against a real git repository

### Test Cases

**listBranches**: returns main, matches pattern, empty for no matches
**createBranch**: creates from base, error on invalid base ref
**showFile**: returns content, null for missing file, error on invalid branch
**log**: returns entries with hash/msg/author/date, respects limit, error on unknown branch
**status**: clean repo, modified files, untracked files
**commit**: commits and returns hash, error on nothing to commit
**Error paths**: NOT_A_REPO against non-git directory

## Acceptance Criteria

- [ ] `GitCliAdapter` implements all 6 `GitPort` methods
- [ ] All methods return `Result<T, GitError>` (never throw)
- [ ] Uses `execFile` (no shell injection)
- [ ] Integration tests run against real git repo (no mocks)
- [ ] Error cases return typed `GitError` with correct codes: `NOT_A_REPO` for non-git directory, `REF_NOT_FOUND` for unknown branch/revision, `NOT_FOUND` for missing git binary, `CONFLICT` for merge conflicts, `COMMAND_FAILED` as catch-all
- [ ] `showFile` returns `ok(null)` (not an error) when file does not exist in the given ref
- [ ] Barrel exports updated in `kernel/infrastructure/index.ts` and `kernel/index.ts`

## Dependencies

- Existing: `GitPort`, `GitError`, `GitLogEntry`, `GitStatus`, `Result`
- External: `node:child_process` (execFile), `node:fs/promises` (mkdtemp for tests), `node:os` (tmpdir for tests)
- No new npm packages required

## Constraints

- macOS/Linux only (no Windows path handling)
- Branch/ref content only for `showFile` (no working tree fallback)
- `execFile` only (no `exec`, no shell interpretation)
- `listBranches` returns local branches only (not remote-tracking)
- `execFile` default `maxBuffer` (1MB) -- sufficient for TFF's own repo operations

# M02-S05 Research: Git CLI Adapter

## Port Contract Verification

All contracts exist and are stable:
- `GitPort` (6 abstract methods) at `src/kernel/ports/git.port.ts`
- `GitLogEntrySchema`, `GitStatusSchema`, `GitFileStatusSchema` at `src/kernel/ports/git.schemas.ts`
- `GitError` with auto-prefixed `GIT.` codes at `src/kernel/errors/git.error.ts`
- `Result<T, E>` with `ok()`, `err()`, `isOk()`, `isErr()`, `match()` at `src/kernel/result.ts`
- `TimestampSchema` = `z.coerce.date()` at `src/kernel/schemas.ts` -- accepts ISO 8601 strings

No existing consumers of `GitPort` in the codebase yet.

## Reference Adapter Patterns

Closest reference: `FsSettingsFileAdapter` (async, Result-returning, external I/O):
- Extends port abstract class
- try/catch wrapping external calls
- `ok(null)` for "not found" semantic
- `err(new DomainError(...))` for failures
- Never throws

Import style: `import { err, ok, type Result } from "@kernel"` (barrel import).

## Git CLI Output Formats (Verified)

### `git branch --list <pattern> --format=%(refname:short)`
- One branch per line, current branch prefixed with `* `
- Detached HEAD: `* ` with empty name after it
- Must strip `* ` prefix and filter empty lines

### `git status --porcelain=v1 --branch`
- First line: `## main...origin/main` or `## HEAD (no branch)`
- Branch: everything before `...` (or end of line)
- Entries: `XY <path>` where XY is two-char status code
- Renamed: `R  old-path -> new-path` (split on ` -> `, take index 1)

### `git log --format=%H%n%s%n%an%n%aI -n <limit>`
- 4 lines per entry: hash, subject, author, ISO 8601 date
- `%aI` produces `2026-03-26T14:07:28+01:00` -- coerces to `Date` via `z.coerce.date()`

### `git show <branch>:<path>`
- Success: raw file content on stdout
- Missing file: exit 128, stderr `"does not exist in"` -- map to `ok(null)`
- Invalid ref: exit 128, stderr `"invalid object name"` -- map to `REF_NOT_FOUND`

### `git commit -m <message>`
- Normal: `[main abc1234] commit message`
- Root: `[main (root-commit) abc1234] initial commit`
- Regex: `/\[\S+\s+(?:\(root-commit\)\s+)?([a-f0-9]+)\]/`

## TypeScript & Test Config

- `"type": "module"` (ESM), Node >= 22, `moduleResolution: "Bundler"`
- Path aliases: `@kernel` -> `src/kernel`, `@kernel/*` -> `src/kernel/*`
- No `.js` extensions in imports
- Vitest `globals: false` -- must import `describe`, `it`, `expect` from `vitest`
- Test pattern: `src/**/*.spec.ts`

## Barrel Export Targets

`src/kernel/infrastructure/index.ts` -- add `export { GitCliAdapter } from "./git-cli.adapter"`
`src/kernel/index.ts` -- add `GitCliAdapter` to the infrastructure re-export line

## Implementation Notes

- `execFile` from `node:child_process` (callback API) -- wrap in `new Promise()`
- No `util.promisify` needed (manual Promise wrapping matches existing patterns)
- `git add` with non-existent paths: fails with exit 128 (not silent)
- No existing git npm packages -- use only `node:child_process`

## Risks

- **Low**: `git branch --format` requires git >= 2.13 (May 2017) -- safe for modern systems
- **Low**: `execFile` maxBuffer 1MB default -- sufficient for TFF repo operations
- **None**: No consumers yet, so no integration risk for this slice

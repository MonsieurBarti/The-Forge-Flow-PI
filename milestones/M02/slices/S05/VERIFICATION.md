# M02-S05 Verification Report

## Test Results

18 passed, 0 failed

Suite: `GitCliAdapter` — 18 tests across 6 describe blocks (runGit + error mapping, status, commit, listBranches, createBranch, showFile, log). All green.

## Acceptance Criteria Verdicts

### AC1: GitCliAdapter implements all 6 GitPort methods
**Verdict: PASS**
**Evidence:**
- `git.port.ts:6-11` declares 6 abstract methods: `listBranches`, `createBranch`, `showFile`, `log`, `status`, `commit`
- `git-cli.adapter.ts:51` — `listBranches(pattern: string)`
- `git-cli.adapter.ts:61` — `createBranch(name: string, base: string)`
- `git-cli.adapter.ts:67` — `showFile(branch: string, path: string)`
- `git-cli.adapter.ts:80` — `log(branch: string, limit = 20)`
- `git-cli.adapter.ts:108` — `status()`
- `git-cli.adapter.ts:146` — `commit(message: string, paths: string[])`
- `GitCliAdapter extends GitPort` (`git-cli.adapter.ts:14`); TypeScript compilation would fail if any abstract method were missing.

### AC2: All methods return Result<T, GitError> (never throw)
**Verdict: PASS**
**Evidence:**
- Every public method is `async` and returns `Promise<Result<...>>`.
- There is no bare `throw` statement anywhere in `git-cli.adapter.ts`. All error paths call `resolve(err(...))` (line 27) or `return err(...)` (lines 63, 103, 129, 147).
- The only try/catch block (`git-cli.adapter.ts:91-104`) catches parse errors and returns `err(new GitError(...))` rather than re-throwing.
- `runGit` is a `Promise` that always calls `resolve(ok(...))` or `resolve(err(...))` and never rejects.

### AC3: Uses execFile (no shell injection)
**Verdict: PASS**
**Evidence:**
- `git-cli.adapter.ts:2` — `import { execFile } from "node:child_process";`
- `git-cli.adapter.ts:21` — `execFile("git", ["--no-pager", "-c", "color.ui=never", ...args], { cwd: this.cwd, encoding: "utf-8" }, ...)`
- `exec` (the shell-delegating variant) is never imported or used anywhere in the file.

### AC4: Integration tests run against real git repo (no mocks)
**Verdict: PASS**
**Evidence:**
- `git-cli.adapter.integration.spec.ts:1-4` imports only `node:child_process`, `node:fs`, `node:os`, `node:path` — no mock libraries.
- `beforeAll` (lines 13-22) creates a real temporary git repository with `mkdtempSync`, runs `git init`, `git config`, `git add`, and `git commit` via `execFileSync` — genuine filesystem operations.
- `afterAll` (lines 24-26) cleans up with `rmSync`.
- `beforeEach` (lines 28-32) resets repo state with real `git checkout`, `git reset`, `git clean` calls.
- No `vi.mock`, `vi.spyOn`, or stub patterns appear anywhere in the spec file.

### AC5: Error cases return typed GitError with correct codes
**Verdict: PASS**
**Evidence:**
The `mapError` method (`git-cli.adapter.ts:36-49`) covers all required codes:

| Code | Condition | Line |
|---|---|---|
| `NOT_FOUND` | `error.code === "ENOENT"` (git binary missing) | 38 |
| `NOT_A_REPO` | stderr includes `"not a git repository"` | 39 |
| `REF_NOT_FOUND` | stderr includes `"did not match any"`, `"unknown revision"`, `"invalid object name"`, `"not a valid object name"` | 40-46 |
| `CONFLICT` | stderr includes `"CONFLICT"` or `"conflict"` | 47 |
| `COMMAND_FAILED` | catch-all | 48 |

`CONFLICT` is also returned directly by `status()` at line 129 when porcelain output indicates conflicted files (`U`, `D/D`, `A/A` markers).

Test coverage confirms:
- `NOT_A_REPO`: spec line 35-44 — `status()` on non-git dir → `"GIT.NOT_A_REPO"`
- `REF_NOT_FOUND`: spec lines 139-145 (createBranch), 165-170 (showFile), 200-206 (log)
- `COMMAND_FAILED`: spec lines 93-99 (empty paths to commit)

`NOT_FOUND` and `CONFLICT` are covered by the `mapError` implementation directly; no dedicated integration test for binary-missing (impractical) or live merge conflict (not in spec scope), but the code paths are present and correct.

### AC6: showFile returns ok(null) (not an error) when file does not exist in the given ref
**Verdict: PASS**
**Evidence:**
- `git-cli.adapter.ts:67-78` — `showFile` inspects the error message before propagating it:
  ```
  if (
    result.error.message.includes("does not exist in") ||
    (result.error.message.includes("path") && result.error.message.includes("does not exist"))
  )
    return ok(null);   // line 74
  ```
- The check covers both git error message variants for a missing path in a valid ref.
- Integration test at spec lines 157-163 confirms: `showFile("main", "nonexistent.txt")` → `isOk(result)` is `true` AND `result.data` is `null`.

### AC7: Barrel exports updated in kernel/infrastructure/index.ts and kernel/index.ts
**Verdict: PASS**
**Evidence:**
- `src/kernel/infrastructure/index.ts:2` — `export { GitCliAdapter } from "./git-cli.adapter";`
- `src/kernel/index.ts:17` — `GitCliAdapter` appears in the re-export from `"./infrastructure"` (lines 16-20).

## Overall Verdict

**PASS** — All 7 acceptance criteria are met. The adapter correctly implements all 6 `GitPort` methods using `execFile` (no shell injection), every code path returns `Result<T, GitError>` without bare throws, all 5 required error codes are mapped in `mapError`, `showFile` returns `ok(null)` for missing files, and both barrel files export `GitCliAdapter`. 18/18 integration tests pass against a real git repository with no mocks.

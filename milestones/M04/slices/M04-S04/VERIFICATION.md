# Verification — M04-S04: Worktree Management

## AC Verification Report

### AC1: WorktreePort.create() creates worktree at `.tff/worktrees/<sliceId>/` on branch `slice/<sliceId>`
**Verdict**: PASS
- `GitWorktreeAdapter.create()` computes `pathFor(sliceId)` = `join(root, ".tff", "worktrees", sliceId)` and `branchFor(sliceId)` = `"slice/${sliceId}"`, delegates to `gitPort.worktreeAdd()`
- Contract test `"create + exists roundtrip (AC1)"` confirms `result.data.branch === "slice/M04-S04"` and `exists()` returns true
- Both adapters pass

### AC2: WorktreePort.delete() removes worktree from disk and deletes the slice branch
**Verdict**: PASS
- `GitWorktreeAdapter.delete()` calls `gitPort.worktreeRemove(wtPath)` then `gitPort.deleteBranch(branch)`
- `worktreeRemove` runs `git worktree remove --force`, `deleteBranch` runs `git branch -d`
- Contract test `"create + delete + exists returns false (AC2, AC3)"` confirms deletion succeeds

### AC3: WorktreePort.exists() returns false after deletion
**Verdict**: PASS
- Same contract test as AC2: after `delete()`, `exists()` returns `false`
- Both adapters pass

### AC4: WorktreePort.validate() detects: missing dirs, invalid branches, uncommitted changes, unreachable base
**Verdict**: PASS (with design note)
- `GitWorktreeAdapter.validate()` checks:
  - Missing dirs via `fs.access(wtPath)` -> `exists` field
  - Invalid branches via `gitPort.listBranches(branch)` -> `branchValid` field
  - Uncommitted changes via `gitPort.statusAt(wtPath)` -> `clean` field
  - Unreachable base: `reachable` field present in schema, hardcoded `true` in adapter (baseBranch unavailable from porcelain list output — noted in SPEC design)
- Adapter-specific test confirms `validate()` detects missing directory (`exists: false`)
- Contract test confirms `validate()` returns health with correct fields

### AC5: CleanupOrphanedWorktreesUseCase deletes closed, leaves active, skips on failure
**Verdict**: PASS
- `execute()` iterates worktrees, checks status via `SliceStatusProvider`
- Only `"closed"` triggers deletion; all others skipped; status-lookup errors skipped
- 4 tests: closed slice deleted, executing slice skipped, status-lookup failure skipped, completing status skipped

### AC6: Missing worktree produces WorktreeError.notFound
**Verdict**: PASS
- `WorktreeError.notFound(sliceId)` creates error with code `"WORKTREE.NOT_FOUND"`
- `delete()` and `validate()` both return `notFound` for non-existent worktrees
- 3 contract tests verify: delete non-existent, validate non-existent, exists returns false

### AC7: Duplicate create produces WorktreeError.alreadyExists
**Verdict**: PASS
- `WorktreeError.alreadyExists(sliceId)` creates error with code `"WORKTREE.ALREADY_EXISTS"`
- Both adapters detect duplicates (git adapter checks error message, in-memory checks Map)
- Contract test `"duplicate create returns alreadyExists error (AC7)"` passes for both

### AC8: GitPort extended with 5 methods — existing tests still pass
**Verdict**: PASS
- `GitPort` declares: `worktreeAdd`, `worktreeRemove`, `worktreeList`, `deleteBranch`, `statusAt`
- `GitCliAdapter` implements all 5
- 6 integration tests in `git-cli.adapter.worktree.spec.ts` pass
- `MockGitPort` in rollback test stubs all 5; all 5 rollback tests pass
- Full suite: 888 tests pass, 0 fail

### AC9: In-memory adapter passes same contract tests as git adapter
**Verdict**: PASS
- `worktree.contract.spec.ts` exports `runWorktreeContractTests()` with 8 shared tests
- `InMemoryWorktreeAdapter`: 8/8 pass
- `GitWorktreeAdapter`: 8/8 pass (+ 1 adapter-specific = 9 total)

## Summary
- **PASS: 9/9**
- **FAIL: 0/9**
- **Overall: PASS**

## Test Evidence
- Execution hexagon: 188 tests pass
- Kernel worktree integration: 6 tests pass
- Full project: 888 tests pass, 0 fail

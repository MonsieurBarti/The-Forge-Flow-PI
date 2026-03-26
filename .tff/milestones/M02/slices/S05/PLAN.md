# M02-S05: Git CLI Adapter — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Implement `GitCliAdapter` extending `GitPort`, wrapping git CLI via `execFile`, returning `Result<T, GitError>` for all operations.
**Architecture:** Kernel infrastructure adapter (`src/kernel/infrastructure/`). Private `runGit` helper centralizes `execFile` + error mapping. Each port method calls `runGit` and parses stdout.
**Tech Stack:** TypeScript, Node `child_process.execFile`, Zod schemas, Vitest integration tests

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/kernel/infrastructure/git-cli.adapter.ts` | Create | Adapter: constructor(cwd), runGit, mapError, 6 port methods |
| `src/kernel/infrastructure/git-cli.adapter.integration.spec.ts` | Create | Integration tests against real temp git repo |
| `src/kernel/infrastructure/index.ts` | Modify | Add `GitCliAdapter` export |
| `src/kernel/index.ts` | Modify | Add `GitCliAdapter` to infrastructure re-export |

---

### Task T01: Test harness + runGit/mapError foundation
**Files:** Create `git-cli.adapter.ts`, Create `git-cli.adapter.integration.spec.ts`
**Traces to:** AC1 (partial), AC2, AC3, AC5 (NOT_A_REPO, NOT_FOUND, COMMAND_FAILED)
- [x] Completed

---

### Task T02: listBranches + createBranch
**Files:** Modify `git-cli.adapter.ts`, Modify `git-cli.adapter.integration.spec.ts`
**Traces to:** AC1 (partial), AC2, AC5 (REF_NOT_FOUND)
**Depends on:** T01
- [x] Completed

---

### Task T03: showFile + log
**Files:** Modify `git-cli.adapter.ts`, Modify `git-cli.adapter.integration.spec.ts`
**Traces to:** AC1 (partial), AC2, AC5 (REF_NOT_FOUND), AC6 (showFile null)
**Depends on:** T01
- [x] Completed

---

### Task T04: status + commit
**Files:** Modify `git-cli.adapter.ts`, Modify `git-cli.adapter.integration.spec.ts`
**Traces to:** AC1 (partial), AC2, AC5 (COMMAND_FAILED)
**Depends on:** T01
- [x] Completed

---

### Task T05: Barrel exports + full verification
**Files:** Modify `src/kernel/infrastructure/index.ts`, Modify `src/kernel/index.ts`
**Traces to:** AC4, AC7
**Depends on:** T02, T03, T04
- [x] Completed

---

## Wave Structure

```
Wave 0: T01 (foundation — runGit, mapError, test harness)
Wave 1: T02, T03, T04 (independent method implementations)
Wave 2: T05 (barrel exports + verification)
```

## AC Traceability

| AC | Tasks |
|---|---|
| AC1: Implements all 6 GitPort methods | T02, T03, T04 |
| AC2: All methods return Result (never throw) | T01, T02, T03, T04 |
| AC3: Uses execFile (no shell injection) | T01 |
| AC4: Integration tests against real git repo | T01, T02, T03, T04 |
| AC5: Error cases return typed GitError codes | T01, T02, T03, T04 |
| AC6: showFile returns ok(null) for missing file | T03 |
| AC7: Barrel exports updated | T05 |

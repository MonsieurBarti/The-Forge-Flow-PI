# Verification — M07-S06 (Post-Fix)

| AC | Verdict | Evidence |
|---|---|---|
| AC1 | PASS | `scope-containment.rule.ts:11-16` blocker on out-of-scope path; 4 unit tests |
| AC2 | PASS | `worktree-state.rule.ts` blocker on wrong branch or dirty worktree; 6 unit tests |
| AC3 | PASS | `budget-check.rule.ts` warning (not blocker) when budget insufficient; 4 unit tests |
| AC4 | PASS | `dependency-check.rule.ts` blocker on incomplete upstream; `tool-policy.rule.ts` blocker on disallowed tool; 8 unit tests |
| AC5 | PASS | Fixed: `execute-slice.use-case.ts:663` now checks `!isFull` — F-full always gets full path. Test: "F-full with clean self-review: still gets full path (AC5)" |
| AC6 | PASS | Reflection blocker replaces settled result → enters retry pass. Test: "reflection blocker: task enters failed list" with `triggeredRetry: true` |
| AC7 | PASS | `default-retry-policy.ts:resolveModel()` walks quality→balanced→budget→escalate. Test: "full chain walkthrough" |
| AC8 | PASS | Fixed: `checkpointBeforeRetry` flag now gated — `if (this.deps.checkpointBeforeRetry)` before `checkpointRepository.save()`. Tests with `checkpointBeforeRetry: true` (default) |
| AC9 | PASS | 4 new entry schemas in `journal-entry.schemas.ts` union (16 total). All include `waveIndex`. 88 journal schema tests pass |
| AC10 | PASS | `Promise.allSettled` + per-task failure collection. Test: "pre-dispatch blocker is task-level: blocked task fails, sibling still dispatched" |
| AC11 | PASS | Retry pass uses sequential `for` loop with `await` in `runRetryPass()`. Runs only after wave `Promise.allSettled` resolves |

## Verdict: PASS (11/11)

All acceptance criteria verified with implementation evidence and test coverage.

### Fix Summary
- **AC5**: Added `isFull` check at line 663 to bypass fast-path for F-full complexity. Added test.
- **AC8**: Added `checkpointBeforeRetry` boolean to `ExecuteSliceUseCaseDeps`. Gated checkpoint save in retry pass.

### Test Coverage
- 2098 tests pass across full suite
- 44 tests in `execute-slice.use-case.spec.ts`
- 29 tests in pre-dispatch rules + adapter
- 15 tests in `default-retry-policy.spec.ts`
- 13 tests in `build-reflection-config.spec.ts`
- 88 tests in journal entry schemas

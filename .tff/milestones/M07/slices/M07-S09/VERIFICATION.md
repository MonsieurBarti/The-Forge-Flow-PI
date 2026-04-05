# Verification — M07-S09: Platform Commands Batch 2 (Management)

## Test Results

- **TypeScript:** 0 errors (`tsc --noEmit`)
- **Tests:** 2338 pass, 0 fail (`vitest run`)
- **Lint:** 1 pre-existing warning (settings.command.spec.ts unused variable)

## Acceptance Criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC1 | **PASS** | `add-slice.use-case.ts:44-81` — auto-generates label, computes position, shifts downstream on `--after`. 7 tests cover append, insert-after, guards, label generation. |
| AC2 | **PASS** | `remove-slice.use-case.ts:8,38-44` — `REMOVABLE_STATUSES = {discussing, researching}`, rejects planning+. Cleanup: worktree (L50-53), state branch (L56-61), code branch (L64-66), artifact directory (L69-83). 8 tests. |
| AC3 | **PASS** | `rollback.command.ts:32-42` — auto-discovers baseCommit from `checkpointRepo.findBySliceId()`. `--base-commit` regex override (L16-17). Error when both missing (L39). `rollback-slice.use-case.ts:75` transitions to planning. |
| AC4 | **PASS** | `audit-milestone.use-case.ts:118-131` — `Promise.all()` dispatches spec-reviewer + security-auditor. L142-155 persists `MilestoneAuditRecord`. `audit-milestone.command.ts:37-43` formats findings table w/ severity. 10 tests. |
| AC5 | **PASS** | `complete-milestone.use-case.ts:97-107` — queries `auditRecordRepo.findLatestByMilestoneId()`, checks `allPassed`. Returns `auditRequired` error (code `MILESTONE.AUDIT_REQUIRED`) when no record ∨ allPassed=false. |
| AC6 | **PASS** | `map-codebase.use-case.ts:65-67` — `Promise.allSettled(ALL_DOC_TYPES.map(...))` dispatches 4 agents. Writes ARCHITECTURE.md, CONVENTIONS.md, STACK.md, CONCERNS.md to `.tff/docs/`. 2 tests. |
| AC7 | **PASS** | `map-codebase.use-case.ts:93-166` — `classifyChanges()` matches files against `INCREMENTAL_PATTERNS`, dispatches only affected types. Returns `skippedDocs` for unaffected. 3 tests. |
| AC8 | **PASS** | `complete-milestone.use-case.ts:244-257` — Step 8.5 wrapped in `if (this.mapCodebase)` + try/catch. Failure logged as warning, ¬ blocks completion. `mapCodebase` is optional constructor param (L54). |
| AC9 | **PASS** | All 4 prompts (`map-architecture.md`, `map-conventions.md`, `map-stack.md`, `map-concerns.md`) instruct: "Use compressor notation (∀, ∃, ∈, ∧, ∨, ¬, →, ⇒). Tables > prose. Code blocks verbatim." + "≤ 40% of equivalent verbose prose". `COMPRESSOR_PROMPT` also injected by `PiAgentDispatchAdapter` (S07). |
| AC10 | **PASS** | All 5 commands have `.command.ts` + `.tool.ts` files. All wired in `extension.ts`: add-slice (L747-758), remove-slice (L760-761), rollback (via execution.extension.ts L35-36), audit-milestone (L778-796), map-codebase (L799-804). |

## Summary

**10/10 AC passed.** All commands implemented, wired, and tested.

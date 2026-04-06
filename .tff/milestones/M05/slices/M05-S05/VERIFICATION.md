# M05-S05 Verification

| AC | Verdict | Evidence |
|---|---|---|
| AC1 | PASS | `ReviewUIPort` abstract class in `src/hexagons/review/domain/ports/review-ui.port.ts` with 3 typed async methods (`presentFindings`, `presentVerification`, `presentForApproval`) returning `Promise<Result<*Response, ReviewUIError>>` |
| AC2 | PASS | `TerminalReviewUIAdapter` sorts findings by `SEVERITY_RANK` (critical first), renders markdown table, and has a dedicated `## Conflicts` section. Tests: "formats findings sorted by severity -- critical first (AC2)" and "renders conflicts in a dedicated section (AC2)" both PASS. |
| AC3 | PASS | `TerminalReviewUIAdapter` returns `Ok` results purely via string formatting, no plannotator dependency. Test: "returns Ok without plannotator (AC3)" PASS. |
| AC4 | PASS | `PlannotatorReviewUIAdapter` invokes `plannotator annotate` via `execFile` subprocess for all 3 methods. Tests: "invokes plannotator annotate via CLI subprocess (AC4)" for presentFindings, presentVerification, and presentForApproval all PASS. |
| AC5 | PASS | `detectPlannotator()` in `src/cli/extension.ts:54-59` uses `execFileSync("which", ["plannotator"])` for PATH check. Lines 99-102: selects `PlannotatorReviewUIAdapter` when found, `TerminalReviewUIAdapter` otherwise. |
| AC6 | PASS | Composition root injects `reviewUI: ReviewUIPort` into `registerWorkflowExtension` (extension.ts:118). `WorkflowExtensionDeps` declares `reviewUI: ReviewUIPort` (workflow.extension.ts:46). Used by `createWriteSpecTool` and `createWritePlanTool` orchestrators. |
| AC7 | PASS | `InMemoryReviewUIAdapter` records each call in `presentations` array with `method` and `context`. Test: "records presentFindings call in log (AC7)" PASS, plus verification and approval recording tests PASS. 4/4 tests pass. |
| AC8 | PASS | Shared `contractSuite` in `review-ui.contract.spec.ts` runs 3 tests per adapter (9 total) for all 3 adapters (InMemory, Terminal, Plannotator with mocked subprocess). All 9 contract tests PASS. |
| AC9 | PASS | `plannotator-review-ui.integration.spec.ts` tests against real plannotator binary, skipped when `TFF_INTEGRATION_PLANNOTATOR` env var is not set. Confirmed: test has status "skipped" when env var absent. |
| AC10 | PASS | All 6 Zod schemas tested in `review-ui.schemas.spec.ts`: FindingsUIContext (valid/reject missing/reject invalid), FindingsUIResponse (valid/reject empty), VerificationUIContext (valid/reject invalid enum), VerificationUIResponse (valid), ApprovalUIContext (valid/reject invalid type), ApprovalUIResponse (with decision/without/with feedback). 13/13 tests PASS. |
| AC11 | PASS | `PlannotatorReviewUIAdapter.presentForApproval` catch block returns `decision: "changes_requested"` on error. Test: "degrades to changes_requested on crash -- never auto-approves (AC11)" PASS. |
| AC12 | PASS | `PlannotatorReviewUIAdapter.presentFindings` catch block returns `acknowledged: true`. Test: "degrades to acknowledged on error (AC12)" PASS. |
| AC13 | PASS | `PlannotatorReviewUIAdapter.presentVerification` catch block returns `accepted: true`. Test: "degrades to accepted on error (AC13)" PASS. |
| AC14 | PASS | `ReviewUIError extends BaseDomainError` in `src/hexagons/review/domain/errors/review-ui.error.ts`. Factory methods: `presentationFailed(context, cause)`, `plannotatorNotFound()`, `feedbackParseError(raw)` -- all 3 present. |
| AC15 | PASS | All 3 adapters return non-empty `formattedOutput` strings. Contract suite checks `formattedOutput.length > 0` for all 9 adapter/method combinations. Terminal adapter spec also checks AC15 explicitly. InMemory defaults include non-empty strings. Plannotator catch blocks include fallback strings. |
| AC16 | PASS | `TerminalReviewUIAdapter.presentVerification` formats criteria as table with `| Criterion | Verdict | Evidence |` headers, PASS/FAIL icons per criterion. Test: "formats criteria as PASS/FAIL table with evidence (AC16)" PASS -- verifies PASS, FAIL, and evidence strings present in output. |
| AC17 | PASS | `src/hexagons/review/index.ts` exports: `ReviewUIPort` (line 63), all 6 schemas as types (lines 93-99) and runtime Zod schemas (lines 101-108): FindingsUIContext/Response, VerificationUIContext/Response, ApprovalUIContext/Response. |

## Test Summary

- `review-ui.schemas.spec.ts`: 13 passed
- `review-ui.contract.spec.ts`: 9 passed
- `terminal-review-ui.adapter.spec.ts`: 5 passed
- `plannotator-review-ui.adapter.spec.ts`: 8 passed
- `in-memory-review-ui.adapter.spec.ts`: 4 passed
- `plannotator-review-ui.integration.spec.ts`: 1 skipped (no env flag)
- **Total: 39 passed, 0 failed, 1 skipped**

## Overall: PASS

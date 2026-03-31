# M04-S06: Agent Status Protocol -- Verification

## Results

| AC | Verdict | Evidence |
|---|---|---|
| AC1 | PASS | `AgentResultSchema` in `src/kernel/agents/agent-result.schema.ts` has `status: AgentStatusSchema` (line 22), no `success: boolean` field. `AgentStatusSchema` is `z.enum(["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"])` (line 3 of `agent-status.schema.ts`). Grep for `success.*boolean` in the schema file returns no matches. Tests in `agent-result.schema.spec.ts` assert `result.status` not `result.success`. |
| AC2 | PASS | `AgentConcernSchema` (line 9-13 of `agent-status.schema.ts`) has `area: z.string().min(1)`, `description: z.string().min(1)`, `severity: z.enum(["info", "warning", "critical"])`. Schema spec rejects empty area, rejects invalid severity. `AgentStatusReportSchema` uses `concerns: z.array(AgentConcernSchema).default([])`. Parser spec confirms `DONE_WITH_CONCERNS` with non-empty concerns array parses correctly. Schema spec tests `DONE` with default empty concerns array. |
| AC3 | PASS | `SelfReviewChecklistSchema` (lines 34-38 of `agent-status.schema.ts`) has `dimensions: z.array(SelfReviewDimensionSchema).length(4)` and `overallConfidence: z.enum(["high", "medium", "low"])`. Dimensions are `z.enum(["completeness", "quality", "discipline", "verification"])`. `AgentResultSchema` includes `selfReview: SelfReviewChecklistSchema` (line 26). Schema spec verifies 4-dimension checklist parses and rejects 3-dimension array. Builder defaults to all-passed, high confidence. |
| AC4 | PASS | `parseAgentStatusReport` in `agent-status-parser.ts` extracts JSON between `<!-- TFF_STATUS_REPORT -->` and `<!-- /TFF_STATUS_REPORT -->` markers (lines 6-7 for constants, lines 11-14 for marker detection), validates with `AgentStatusReportSchema.safeParse()` (line 29). Parser spec: 7 tests all pass -- valid report extraction, report with concerns, missing markers, malformed JSON, schema mismatch, extra text around markers, raw output preservation. |
| AC5 | PASS | `AgentStatusParseError` in `agent-status-parse.error.ts` extends `BaseDomainError`, has `readonly code = "AGENT_STATUS.PARSE_FAILED"` (line 4), constructor takes `message`, `rawOutput`, and optional `cause`. Parser spec asserts `result.error.code === "AGENT_STATUS.PARSE_FAILED"` and `result.error.rawOutput` contains original text. All 7 parser tests pass. |
| AC6 | PASS | `crossCheckAgentResult` in `agent-status-cross-checker.ts` implements all 4 checks: (1) files-claim for fixer agents with completeness passed but empty filesChanged (lines 25-35), (2) error-consistency for DONE with populated error (lines 38-44), (3) concern-consistency for DONE with non-empty concerns (lines 47-53), (4) cost-sanity for zero duration/cost with non-zero tokens (lines 56-63). Cross-checker spec: 8 tests all pass, including the negative test that non-fixer agents are not flagged for empty filesChanged. |
| AC7 | PASS | `isSuccessfulStatus` in `agent-status.schema.ts` (lines 47-49): returns `status === "DONE" || status === "DONE_WITH_CONCERNS"`. Schema spec has 4 explicit tests: DONE -> true, DONE_WITH_CONCERNS -> true, NEEDS_CONTEXT -> false, BLOCKED -> false. All pass. |
| AC8 | PASS | `RecordTaskMetricsUseCase` (line 34 of `record-task-metrics.use-case.ts`): `success: isSuccessfulStatus(event.agentResult.status)`. Imports `isSuccessfulStatus` from `@kernel/agents`. Use case spec has 2 tests: one verifying DONE maps to success=true (via builder default), one verifying BLOCKED maps to success=false (`.asBlocked("timeout")`). Both tests pass (5 passed in the event spec run). |
| AC9 | PASS | `AGENT_STATUS_PROMPT` constant in `agent-status-prompt.ts` contains: (1) status definitions for all 4 statuses with descriptions (lines 7-10), (2) self-review checklist instructions with 4 dimensions (lines 15-19), (3) JSON output format between `<!-- TFF_STATUS_REPORT -->` markers (lines 25-41), (4) "Never report DONE if you have unresolved concerns" rule (line 45). Prompt spec verifies all 4 aspects with dedicated tests. All 4 pass. |
| AC10 | PASS | `PiAgentDispatchAdapter` in `pi-agent-dispatch.adapter.ts`: (1) injects `AGENT_STATUS_PROMPT` into system prompt (lines 125-127), (2) parses output with `parseAgentStatusReport(output)` on success (line 152), (3) on parse failure: falls back to BLOCKED status with "status-protocol" critical concern (lines 161-171), (4) on dispatch failure (catch block): returns err with `AgentDispatchError` without parsing (lines 191-198), (5) appends cross-checker discrepancies as concerns (lines 173-178). |

## Overall Verdict

**PASS**

## Test Suite

- Test Files: 112 passed, 0 failed
- Tests: 972 passed, 3 skipped
- Typecheck: clean (0 errors)

## Notes

### Circular dependency fix applied

Initial verification found `AgentStatusParseError` importing `BaseDomainError` from `@kernel` (barrel), creating a circular dependency that broke 76 test files at import. Fixed in commit `fix(S06/T01): resolve circular dependency in agent-status-parse.error` by changing to relative import `../errors/base-domain.error`, matching the pattern used by all other kernel error classes. All 112 test files now pass.

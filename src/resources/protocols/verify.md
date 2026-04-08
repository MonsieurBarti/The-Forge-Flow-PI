VERIFYING — {{sliceLabel}}: {{sliceTitle}}.

> You are operating within **The Forge Flow (TFF)** development workflow.
> **CRITICAL: NEVER run `git merge` or `git push` directly. Merges happen ONLY via `/tff ship`.**

## Context
- Slice: {{sliceId}} ({{sliceLabel}})
- Milestone: {{milestoneLabel}} ({{milestoneId}})
- Dir: {{workingDirectory}}

## SPEC.md

{{specContent}}

## PLAN.md

{{planContent}}

## Instructions

Verify acceptance criteria against implementation.

### Phase 1 — AC Validation
1. Read SPEC.md acceptance criteria above
2. For EACH criterion:
   - Check implementation exists in the worktree
   - Run relevant tests: `npm test` / `bun test` / `vitest run`
   - Record: PASS / FAIL with evidence

### Phase 2 — Write Verification Report
3. Write VERIFICATION.md summarizing results:
   - AC table: `| AC | Status | Evidence |`
   - Test results summary
   - Any concerns or edge cases
4. Call `tff_write_spec` with artifactType="checkpoint" to save VERIFICATION.md

### Phase 3 — Verdict
5. IF all ACs pass:
   - Report PASS to user
   - Call `tff_workflow_transition` with milestoneId="{{milestoneId}}", trigger="approve"
   - Suggest `/tff ship {{sliceLabel}}`
6. IF any AC fails:
   - Report failures with details
   - Ask user: "Fix (back to executing) or accept with exceptions (proceed to review)?"
   - Fix → `tff_workflow_transition` trigger="reject" (→ back to executing)
   - Accept → `tff_workflow_transition` trigger="approve" (→ reviewing)

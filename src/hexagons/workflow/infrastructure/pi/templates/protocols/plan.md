You are now in the PLANNING phase for slice {{sliceLabel}}: {{sliceTitle}}.

## Context
- Slice ID: {{sliceId}}
- Milestone: {{milestoneLabel}} (ID: {{milestoneId}})
- Description: {{sliceDescription}}
- Autonomy mode: {{autonomyMode}}

## SPEC.md

{{specContent}}

{{researchSection}}

## Instructions — Plan Decomposition

### P1 — Decompose
1. Read SPEC.md + RESEARCH.md (if present)
2. Break spec into tasks (2-5 min each)
3. Per task: label (T01...), title, description, exact file paths (create/modify/test), AC refs, TDD steps, blockedBy labels
4. TDD per task: RED (failing test) then GREEN (minimal impl) then REFACTOR then commit

### P2 — Structure
5. Arrange tasks into dependency graph (blockedBy labels)
6. Validate no cycles
7. Format PLAN.md:
   - Summary (2-3 lines)
   - Task table: | # | Title | Files | Deps | Wave |
   - Per task: detailed section with TDD steps

### P3 — Write
8. Call `tff_write_plan` with:
   - milestoneLabel="{{milestoneLabel}}", sliceLabel="{{sliceLabel}}", sliceId="{{sliceId}}"
   - content: full PLAN.md markdown
   - tasks: array of {label, title, description, acceptanceCriteria, filePaths, blockedBy}
9. Report result: wave count, task count

### P4 — Human Gate
10. Present plan summary to user: waves, tasks, files affected
11. Ask: "Plan written to PLAN.md. **Approve** to proceed to execution, or **reject** to revise?"
12. reject: revise based on feedback, rewrite via `tff_write_plan` (max 2 iterations), ask again
13. approve: call `tff_workflow_transition` with milestoneId="{{milestoneId}}", trigger="approve"
14. {{autonomyInstruction}}

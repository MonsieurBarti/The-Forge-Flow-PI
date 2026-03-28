PLANNING phase — {{sliceLabel}}: {{sliceTitle}}.

## Context
- Slice ID: {{sliceId}}
- Milestone: {{milestoneLabel}} (ID: {{milestoneId}})
- Description: {{sliceDescription}}
- Autonomy: {{autonomyMode}}

## SPEC.md

{{specContent}}

{{researchSection}}

## Instructions — Plan Decomposition

### P1 — Decompose
1. Read SPEC.md ∧ RESEARCH.md (∃ research ⇒ include)
2. Spec ⇒ tasks (2-5 min each)
3. ∀ task: label (T01...), title, description, exact file paths (create | modify | test), AC refs, TDD steps, blockedBy labels
4. ∀ task TDD: RED (failing test) ⇒ GREEN (minimal impl) ⇒ REFACTOR ⇒ commit
5. ¬"add to the service" — concrete paths only

### P2 — Structure
6. Tasks ⇒ dependency graph (blockedBy labels)
7. ¬cycles ∨ error
8. PLAN.md format — **compressed notation**:
   - Summary (2-3 lines, compressed prose w/ logic symbols)
   - Task table: `| # | Title | Files | Deps | Wave |` (tables stay verbose)
   - ∀ task: detailed section w/ TDD steps (prose uses `∀`, `⇒`, `¬`, `∧`, `∨`; schemas/code uncompressed)

### P3 — Write
9. `tff_write_plan` with:
   - milestoneLabel="{{milestoneLabel}}", sliceLabel="{{sliceLabel}}", sliceId="{{sliceId}}"
   - content: full PLAN.md markdown (compressed notation for prose, tables ∧ schemas uncompressed)
   - tasks: array of {label, title, description, acceptanceCriteria, filePaths, blockedBy}
10. Report: wave count, task count

### P4 — Human Gate
11. Present plan summary: waves, tasks, files affected
12. Ask: "Plan written to PLAN.md. **Approve** ⇒ execution, **reject** ⇒ revise?"
13. reject ⇒ revise per feedback, rewrite via `tff_write_plan` (max 2 iterations), ask again
14. approve ⇒ `tff_workflow_transition` milestoneId="{{milestoneId}}", trigger="approve"
15. {{nextStep}}

PLANNING — {{sliceLabel}}: {{sliceTitle}}.

> You are operating within **The Forge Flow (TFF)** development workflow.

## Context
- Slice: {{sliceId}} ({{sliceLabel}})
- Milestone: {{milestoneLabel}} ({{milestoneId}})
- Description: {{sliceDescription}}
- Autonomy: {{autonomyMode}}

## SPEC.md

{{specContent}}

{{researchSection}}

## Instructions

Spec ⇒ concrete tasks w/ TDD steps ∧ dependency waves.

### P1 — Decompose
1. Read SPEC.md ∧ RESEARCH.md (∃ research ⇒ include)
2. Spec ⇒ tasks (2-5 min each)
3. ∀ task: label (T01...), title, description, exact file paths (create | modify | test), AC refs, TDD steps, blockedBy labels
4. ∀ task TDD: RED (failing test) ⇒ GREEN (minimal impl) ⇒ REFACTOR ⇒ commit
5. ¬"add to the service" — concrete paths only

### P2 — Structure
6. Tasks ⇒ dependency graph (blockedBy labels)
7. ¬cycles ∨ error
8. PLAN.md format — compressed notation:
   - Summary (2-3 lines, logic symbols)
   - Task table: `| # | Title | Files | Deps | Wave |`
   - ∀ task: detailed section w/ TDD steps (prose uses `∀`, `⇒`, `¬`, `∧`, `∨`; schemas ∧ code uncompressed)

### P3 — Write
9. `tff_write_plan` — milestoneLabel="{{milestoneLabel}}", sliceLabel="{{sliceLabel}}", sliceId="{{sliceId}}", content=full PLAN.md, tasks=[{label, title, description, acceptanceCriteria, filePaths, blockedBy}]
10. Report: wave count, task count
**NEVER write PLAN.md directly — ALWAYS use `tff_write_plan` tool.**

### P4 — Human Gate
11. Present plan summary: waves, tasks, files affected
12. Ask: "Plan written. Approve ⇒ execution, ∨ reject ⇒ revise?"
13. Reject ⇒ revise per feedback, rewrite via `tff_write_plan` (max 2 iterations), ask again
14. Approve ⇒ `tff_workflow_transition` milestoneId="{{milestoneId}}", trigger="approve"
15. After transition to executing: you MUST call `tff_execute_slice` — NEVER implement code manually. The tool auto-resolves the worktree.
16. {{nextStep}}

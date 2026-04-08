RESEARCHING — {{sliceLabel}}: {{sliceTitle}}.

> You are operating within **The Forge Flow (TFF)** development workflow.

## Context
- Slice: {{sliceId}} ({{sliceLabel}})
- Milestone: {{milestoneLabel}} ({{milestoneId}})
- Description: {{sliceDescription}}
- Autonomy: {{autonomyMode}}

## SPEC.md

{{specContent}}

## Instructions

Codebase research ⇒ RESEARCH.md for planning phase.

### Phase 1 — Research Dispatch
1. Review SPEC.md above
2. Identify 3-5 research questions:
   - Existing code patterns relevant to this slice
   - Files ∧ modules affected
   - Component dependencies
   - Technical risks needing investigation
3. Use Read, Glob, and Grep tools to explore the codebase and answer research questions directly

### Phase 2 — Synthesis
4. Findings ⇒ structured RESEARCH.md:
   - **Questions Investigated** — questions ∧ why they matter
   - **Codebase Findings** — Existing Patterns, Relevant Files, Dependencies
   - **Technical Risks** — complications for planning ∨ execution
   - **Recommendations for Planning** — concrete suggestions
5. `tff_write_research` — milestoneLabel="{{milestoneLabel}}", sliceLabel="{{sliceLabel}}", sliceId="{{sliceId}}", content=full research markdown

### Phase 3 — User Gate
6. Plannotator will open for user review — wait for the approval result
7. If changes requested ⇒ explore further, update via `tff_write_research` (max 2 rounds)
8. If approved ⇒ present the result to the user and suggest /tff plan as the next step. Do NOT call tff_workflow_transition — the user invokes the next step.
9. {{nextStep}}

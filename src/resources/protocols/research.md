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
6. Present key findings summary
7. Ask: "Research complete. Approve ⇒ planning, ∨ request deeper investigation?"
8. Deeper investigation requested ⇒ explore further with filesystem tools (max 2 rounds), update via `tff_write_research`, ask again
9. Approved ⇒ `tff_workflow_transition` milestoneId="{{milestoneId}}", trigger="next"
10. {{nextStep}}

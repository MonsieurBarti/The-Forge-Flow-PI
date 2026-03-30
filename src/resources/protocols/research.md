RESEARCHING — {{sliceLabel}}: {{sliceTitle}}.

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
3. Dispatch single Explore agent w/ research questions

### Phase 2 — Synthesis
4. Agent findings ⇒ structured RESEARCH.md:
   - **Questions Investigated** — questions ∧ why they matter
   - **Codebase Findings** — Existing Patterns, Relevant Files, Dependencies
   - **Technical Risks** — complications for planning ∨ execution
   - **Recommendations for Planning** — concrete suggestions
5. `tff_write_research` — milestoneLabel="{{milestoneLabel}}", sliceLabel="{{sliceLabel}}", sliceId="{{sliceId}}", content=full research markdown

### Phase 3 — User Gate
6. Present key findings summary
7. Ask: "Research complete. Approve ⇒ planning, ∨ request deeper investigation?"
8. Deeper investigation requested ⇒ dispatch another Explore agent (max 2 rounds), update via `tff_write_research`, ask again
9. Approved ⇒ `tff_workflow_transition` milestoneId="{{milestoneId}}", trigger="next"
10. {{nextStep}}

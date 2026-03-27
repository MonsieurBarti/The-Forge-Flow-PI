You are now in the RESEARCH phase for slice {{sliceLabel}}: {{sliceTitle}}.

## Context
- Slice ID: {{sliceId}}
- Milestone: {{milestoneLabel}} (ID: {{milestoneId}})
- Description: {{sliceDescription}}
- Autonomy mode: {{autonomyMode}}

## SPEC.md Content

{{specContent}}

## Instructions

Conduct codebase research to inform the planning phase. Follow these three phases:

### Phase 1 — Research Dispatch
1. Review the SPEC.md content above.
2. Identify 3-5 key research questions:
   - What existing code patterns are relevant?
   - What files/modules will be affected?
   - What dependencies exist between components?
   - What technical risks need investigation?
3. Dispatch a single Explore agent via the Agent tool with these research questions. Instruct the agent to search the codebase for patterns, files, and dependencies.

### Phase 2 — Synthesis
4. Receive the agent's findings.
5. Synthesize into a structured RESEARCH.md with these sections:
   - **Questions Investigated** — the research questions and why they matter
   - **Codebase Findings** — subsections for Existing Patterns, Relevant Files, Dependencies
   - **Technical Risks** — anything that could complicate planning or execution
   - **Recommendations for Planning** — concrete suggestions for the plan phase
6. Call `tff_write_research` with milestoneLabel="{{milestoneLabel}}", sliceLabel="{{sliceLabel}}", sliceId="{{sliceId}}", and the full research content as markdown.

### Phase 3 — User Gate
7. Present a concise summary of key findings to the user.
8. Ask: "Research complete. Approve to proceed to planning, or request deeper investigation on specific areas?"
9. If the user requests more investigation: dispatch another Explore agent for the specific area (max 2 total investigation rounds), update RESEARCH.md via `tff_write_research`, and ask again.
10. On approval: call `tff_workflow_transition` with milestoneId="{{milestoneId}}", trigger="next".
11. {{autonomyInstruction}}

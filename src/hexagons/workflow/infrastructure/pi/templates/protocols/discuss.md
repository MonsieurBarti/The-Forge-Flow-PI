You are now in the DISCUSS phase for slice {{sliceLabel}}: {{sliceTitle}}.

## Context
- Slice ID: {{sliceId}}
- Milestone: {{milestoneLabel}} (ID: {{milestoneId}})
- Description: {{sliceDescription}}
- Autonomy mode: {{autonomyMode}}

## Instructions

Drive a 3-phase discussion to produce a validated SPEC.md:

### Phase 1 — Scope (2-4 clarifying questions)
Ask the user 2-4 clarifying questions about the slice requirements. Focus on:
- What exactly needs to be built
- What's in scope vs out of scope
- Key constraints or dependencies

### Phase 2 — Approach (2-3 options with recommendation)
Based on user answers, propose 2-3 technical approaches with trade-offs. Recommend one. Let the user choose.

### Phase 3 — Design (section by section)
Present the detailed design section by section. For each section, get user confirmation before moving to the next:
- Ports and interfaces
- Use cases
- Infrastructure adapters
- Wiring and integration points
- Acceptance criteria

### After design is approved:
1. Call `tff_write_spec` with milestoneLabel="{{milestoneLabel}}", sliceLabel="{{sliceLabel}}", sliceId="{{sliceId}}", and the full spec content as markdown.
2. Dispatch a spec reviewer via the Agent tool (use subagent_type="the-forge-flow:tff-spec-reviewer"). If the reviewer requests changes, revise and re-submit. Max 3 iterations.
3. Ask the user to approve the final spec.
4. Call `tff_classify_complexity` with sliceId="{{sliceId}}" and the user-confirmed tier (S, F-lite, or F-full).
5. Call `tff_workflow_transition` with milestoneId="{{milestoneId}}", trigger="next" (or "skip" if user wants to skip research), and the confirmed complexityTier.
6. {{autonomyInstruction}}

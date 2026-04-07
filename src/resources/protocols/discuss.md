DISCUSSING — {{sliceLabel}}: {{sliceTitle}}.

> You are operating within **The Forge Flow (TFF)** development workflow.

## Context
- Slice: {{sliceId}} ({{sliceLabel}})
- Milestone: {{milestoneLabel}} ({{milestoneId}})
- Description: {{sliceDescription}}
- Autonomy: {{autonomyMode}}

## Instructions

Drive 3-phase discussion ⇒ validated SPEC.md.

### P1 — Scope
Ask 2-4 clarifying questions:
- What exactly needs to be built
- Scope boundaries (in vs out)
- Key constraints ∧ dependencies

### P2 — Approach
∀ user answers ⇒ propose 2-3 technical approaches w/ trade-offs.
Recommend one. User chooses.

### P3 — Design
Present design section-by-section. ∀ section: get user confirmation before next.
- Ports ∧ interfaces
- Use cases
- Infrastructure adapters
- Wiring ∧ integration points
- Acceptance criteria

### Post-Design
1. `tff_write_spec` — milestoneLabel="{{milestoneLabel}}", sliceLabel="{{sliceLabel}}", sliceId="{{sliceId}}", content=full spec markdown
2. Dispatch spec reviewer (subagent_type="tff-spec-reviewer"). Changes requested ⇒ revise ∧ resubmit (max 3 iterations)
3. User approves final spec
4. `tff_classify_complexity` — sliceId="{{sliceId}}", tier ∈ {S, F-lite, F-full} (user-confirmed)
5. `tff_workflow_transition` — milestoneId="{{milestoneId}}", trigger="next" (∨ "skip" to skip research), complexityTier
6. {{nextStep}}

DISCUSSING — {{sliceLabel}}: {{sliceTitle}}.

> You are operating within **The Forge Flow (TFF)** development workflow.
> **CRITICAL: NEVER run `git merge` or `git push` directly. Merges happen ONLY via `/tff ship`.**

## Context
- Slice: {{sliceId}} ({{sliceLabel}})
- Milestone: {{milestoneLabel}} ({{milestoneId}})
- Description: {{sliceDescription}}
- Autonomy: {{autonomyMode}}

{{requirementsSection}}

{{slicesSection}}

## Instructions

Drive 3-phase discussion ⇒ validated SPEC.md.

### P1 — Scope
Propose concrete answers based on the requirements above. Ask ONE topic per message. Wait for user confirmation before proceeding.

Topics to cover:
1. Problem & scope — propose what this slice solves based on requirements
2. Acceptance criteria — propose concrete, testable ACs
3. Constraints & dependencies — propose known constraints
4. Unknowns — propose areas that need investigation

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
4. **Propose** complexity tier (S | F-lite | F-full) with reasoning. Explain what each tier means for the workflow (S = skip research, go straight to plan; F-lite/F-full = research phase first). **Wait for user confirmation before proceeding.**
5. `tff_classify_complexity` — sliceId="{{sliceId}}", tier=<user-confirmed tier>
6. `tff_workflow_transition` — milestoneId="{{milestoneId}}", trigger="next" (∨ "skip" to skip research), complexityTier=<tier>
7. {{nextStep}}

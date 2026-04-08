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
2. Plannotator will open for user review — wait for the approval result
3. If approved: **propose** complexity tier (S | F-lite | F-full) with reasoning. Explain what each tier means (S = skip research; F-lite/F-full = research first). **Wait for user confirmation.**
4. After user confirms tier: call `tff_classify_complexity` with the confirmed tier, then call `tff_workflow_transition` with trigger="next" (or "skip" for S-tier)
5. Present the result and suggest the next command. Do NOT invoke it — the user decides.
6. {{nextStep}}

# M03: Workflow Engine

## Goal

Build the workflow orchestrator hexagon that drives the full slice lifecycle, cross-hexagon event wiring, and the phase commands (discuss, research, plan).

## Requirements

### R01: WorkflowSession Aggregate

- `WorkflowSession` aggregate with `WorkflowSessionPropsSchema` (id, milestoneId, sliceId, currentPhase, previousPhase, retryCount, autonomyMode, timestamps)
- `WorkflowPhaseSchema`: idle, discussing, researching, planning, executing, verifying, reviewing, shipping, completing-milestone, paused, blocked
- `WorkflowTriggerSchema`: start, next, skip, back, fail, approve, reject, pause, resume, abort
- `trigger(trigger, guardContext)`, `assignSlice(sliceId)`, `clearSlice()` business methods
- One WorkflowSession per milestone (cardinality enforcement)

**AC:**
- Declarative transition table (not if-else chains)
- Guard functions: `notSTier`, `isSTier`, `allSlicesClosed`, `retriesExhausted`
- Pause saves previousPhase; resume restores it

### R02: State Machine Transitions

Full transition table:
- idle + start -> discussing
- discussing + next -> researching (guard: notSTier) | planning (guard: isSTier)
- discussing + skip -> planning
- researching + next -> planning
- planning + approve -> executing (human gate)
- planning + reject -> planning (replan, retryCount++)
- executing + next -> verifying
- verifying + approve -> reviewing
- verifying + reject -> executing (retryCount++)
- reviewing + approve -> shipping (human gate)
- reviewing + reject -> executing (retryCount++)
- shipping + next -> idle (slice -> closed)
- idle + next -> completing-milestone (guard: allSlicesClosed)
- Any active + fail -> blocked (guard: retriesExhausted)
- Any active + pause -> paused
- paused + resume -> previousPhase

**AC:**
- All transitions tested (including back-edges and guards)
- retryCount > maxRetries triggers `blocked` with escalation
- Phase changes synchronized with slice status transitions

### R03: Autonomy Modes

- `guided`: pause at every transition for human approval
- `plan-to-pr`: auto-advance non-gate phases, pause at human gates (plan approval, review approval, ship approval)
- `shouldAutoTransition(phase, mode)` function
- Max retries configurable (default 2) before escalation
- Escalation object: sliceId, phase, reason, attempts, lastError

**AC:**
- Guided mode always pauses
- Plan-to-pr mode auto-transitions non-gate phases
- Escalation presented to human after max retries

### R04: Cross-Hexagon Event Wiring

- Workflow orchestrator explicitly calls use cases in sequence (not multiple hexagons subscribing to same event)
- Domain events for notifications only (fire-and-forget)
- Synchronous cross-hexagon queries go through ports
- `WorkflowPhaseChangedEvent` emitted on every transition

**AC:**
- No race conditions from parallel event handlers
- Workflow drives slice transitions (single source of truth)

### R05: Context Staging Area

- Per-invocation context assembly: system prompt + relevant code + docs + skill markdown + task description
- Phase-relevant skill injection (not all 18 skills):
  - Discussing: brainstorming
  - Researching: none (free-form)
  - Planning: writing-plans, stress-testing-specs
  - Executing: test-driven-development, hexagonal-architecture, commit-conventions
  - Verifying: acceptance-criteria-validation, verification-before-completion
  - Reviewing: code-review-protocol
  - Shipping: finishing-work, commit-conventions
- Max 3 skills per dispatch (rigid skills prioritized)
- Structured context package per invocation (not raw prompts)

**AC:**
- Each agent invocation gets a structured context package
- Skill injection respects phase mapping and max limit
- Context includes only phase-relevant information (no full-project dump)

### R06: Discuss Command (`/tff:discuss`)

- Multi-turn Q&A directly in orchestrator (not delegated -- conversation not delegable)
- Phase 1 (Scope): 2-4 clarifying questions
- Phase 2 (Approach): 2-3 approaches with trade-offs
- Phase 3 (Design): section-by-section, confirm each
- Complexity classification at end of discuss (user confirms tier)
- Produces SPEC.md in `.tff/milestones/<M0X>/slices/<slice-id>/`

**AC:**
- Discuss workflow runs interactively (not via subagent)
- Complexity tier confirmed by user (no auto-routing)

### R07: Research Command (`/tff:research`)

- Optional for F-lite, required for F-full, skipped for S-tier
- Agent dispatched to investigate technical approach
- Produces RESEARCH.md

**AC:**
- Research agent has access to codebase exploration tools
- Output saved as structured markdown

### R08: Plan Command (`/tff:plan`)

- Break spec into bite-sized tasks (2-5 min each)
- Each task: description, files (create/modify/test), acceptance criteria refs, dependencies
- Wave detection on task dependency graph
- Plan presented for human approval (human gate via review UI)
- Produces PLAN.md
- TDD steps per task: exact code, exact commands, exact git commands

**AC:**
- Tasks have exact file paths (not "add to the service")
- Dependency graph validated (no cycles)
- Plan approval required before execution

### R09: Next-Step Suggestions

- Every command ends with a next-step suggestion based on current state
- Full state->suggestion map (from TFF-CC conventions)
- Includes paused/resumed states

**AC:**
- No command exits without a next-step suggestion
- Suggestion matches current slice/milestone state

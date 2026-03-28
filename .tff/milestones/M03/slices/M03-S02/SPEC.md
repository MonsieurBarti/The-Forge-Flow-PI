# M03-S02: Autonomy Modes

## Overview

Add autonomy decision logic to the workflow hexagon: a pure `shouldAutoTransition` function, an Escalation value object for retry-exhaustion, and a `WorkflowEscalationRaisedEvent`.

The aggregate gets a thin query method delegating to the pure function. The orchestrator (S05-S07) will consume the aggregate method; status/UI can import the pure function directly.

### Deferred to Other Slices

- **Event handler wiring** — deferred to S03 (Cross-hexagon event wiring). This slice defines `WorkflowEscalationRaisedEvent`; S03 wires the handler.
- **Orchestrator consumption** — deferred to S05-S07 (Discuss/Research/Plan commands). Those slices call `session.shouldAutoTransition` to decide whether to auto-advance.
- **UI/status display** — deferred to S08 (Next-step suggestions). S08 imports `shouldAutoTransition` directly to show whether next step will auto-advance.

## Requirements

- R03: Autonomy modes (full)
- R01: Escalation object (deferred from S01)

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| shouldAutoTransition placement | Pure function + aggregate query | Pure function is testable and importable by both orchestrator and UI. Aggregate query provides convenient access for in-context callers. |
| Escalation modeling | Value object (Zod schema + class) | Consistent with existing domain patterns (Entity, AggregateRoot). Escalation has identity-less semantics and a summary behavior. |
| Human gate definition | Declarative map per mode | Single source of truth. Easy to extend if new modes are added. |
| Escalation event | Defined here, wired in S03 | Consistent with S01 pattern (defined WorkflowPhaseChangedEvent without wiring). Keeps event close to its domain concept. |
| Escalation emission | Conditional in `applyTransition` | Escalation is a consequence of arriving at `blocked`, not a table-level effect. A `toPhase === 'blocked'` conditional after phase assignment keeps the transition table phase-agnostic. |
| `lastError` source | `GuardContext.lastError` field | Caller assembling the context knows the error. Cleanest extension point — no signature changes to `trigger()`. |

## Autonomy Policy

### Human Gates by Mode

```typescript
const HUMAN_GATES: Record<AutonomyMode, ReadonlySet<WorkflowPhase>> = {
  'guided': new Set(ACTIVE_PHASES), // every active phase is a gate (from transition-table.ts)
  'plan-to-pr': new Set([
    'planning',  // plan approval (approve trigger)
    'reviewing', // PR review (approve trigger)
    'shipping',  // ship approval (next trigger)
  ]),
}
```

### AutoTransitionDecision

```typescript
AutoTransitionDecisionSchema = z.object({
  autoTransition: z.boolean(),
  isHumanGate: z.boolean(),
})
type AutoTransitionDecision = z.infer<typeof AutoTransitionDecisionSchema>
```

### Functions

```typescript
export function shouldAutoTransition(
  phase: WorkflowPhase,
  mode: AutonomyMode,
): AutoTransitionDecision
```

- `guided` mode: returns `{ autoTransition: false, isHumanGate: true }` for ALL active phases
- `plan-to-pr` mode: returns `{ autoTransition: false, isHumanGate: true }` for gates (planning, reviewing, shipping); `{ autoTransition: true, isHumanGate: false }` for non-gate active phases
- Non-active phases (idle, paused, blocked, completing-milestone): always `{ autoTransition: false, isHumanGate: false }`

```typescript
export function getHumanGates(
  mode: AutonomyMode,
): ReadonlySet<WorkflowPhase>
```

Returns the set of phases that require human approval for the given mode.

## Escalation Value Object

### Schema

```typescript
EscalationPropsSchema = z.object({
  sliceId: IdSchema,
  phase: WorkflowPhaseSchema,
  reason: z.string(),
  attempts: z.number().int().min(1),
  lastError: z.string().nullable(),
  occurredAt: TimestampSchema,
})
type EscalationProps = z.infer<typeof EscalationPropsSchema>
```

### Class

```typescript
class Escalation extends ValueObject<EscalationProps> {
  static create(props: EscalationProps): Escalation
  static fromRetryExhaustion(
    sliceId: string,
    phase: WorkflowPhase,
    retryCount: number,
    lastError: string | null,
  ): Escalation

  get summary(): string
  // e.g. "Slice abc: blocked at planning after 3 attempts"
}
```

## Events

### WorkflowEscalationRaisedEvent

```typescript
Props: {
  ...DomainEventProps,
  escalation: EscalationProps,
}
eventName = EVENT_NAMES.WORKFLOW_ESCALATION_RAISED
```

Add `WORKFLOW_ESCALATION_RAISED` to kernel `EVENT_NAMES`.

## Aggregate Changes

### WorkflowSession modifications

1. **New getter** — `get shouldAutoTransition(): boolean`
   - Delegates to pure `shouldAutoTransition(this.currentPhase, this.autonomyMode).autoTransition`

2. **Modify `applyTransition()` method** — add conditional after phase assignment:
   - If `toPhase === 'blocked'`: create `Escalation.fromRetryExhaustion(this.sliceId, this.currentPhase, this.retryCount, ctx.lastError)`
   - Store escalation on props (`lastEscalation`)
   - Emit `WorkflowEscalationRaisedEvent` with escalation props
   - This keeps the transition table phase-agnostic; escalation is a consequence of arriving at `blocked`, not a table-level effect

3. **New getter** — `get lastEscalation(): Escalation | null`
   - Returns the stored escalation from props (set during blocked transition)

### Schema changes (workflow-session.schemas.ts)

- Add `lastEscalation: EscalationPropsSchema.nullable().default(null)` to `WorkflowSessionPropsSchema`
- Add `lastError: z.string().nullable().default(null)` to `GuardContextSchema` (caller provides the error that triggered retry exhaustion)

## File Layout

```
src/hexagons/workflow/
  domain/
    autonomy-policy.ts              # NEW
    autonomy-policy.spec.ts         # NEW
    escalation.vo.ts      # NEW
    escalation.vo.spec.ts           # NEW
    workflow-session.aggregate.ts   # MODIFY
    workflow-session.aggregate.spec.ts # MODIFY
    workflow-session.schemas.ts     # MODIFY (add EscalationPropsSchema, lastEscalation)
    events/
      workflow-escalation-raised.event.ts  # NEW
  index.ts                          # MODIFY (export new types)
src/hexagons/kernel/
  domain/event-names.ts             # MODIFY (add WORKFLOW_ESCALATION_RAISED)
```

## Acceptance Criteria

1. `shouldAutoTransition` returns `autoTransition=false` for ALL phases when `mode='guided'`
2. `shouldAutoTransition` returns `autoTransition=false` only for human gates (planning, reviewing, shipping) when `mode='plan-to-pr'`
3. `shouldAutoTransition` returns `autoTransition=true` for non-gate phases in `plan-to-pr` mode
4. `getHumanGates('guided')` returns all active phases
5. `getHumanGates('plan-to-pr')` returns exactly `{planning, reviewing, shipping}`
6. `Escalation.fromRetryExhaustion()` creates correct VO with summary string
7. Aggregate emits `WorkflowEscalationRaisedEvent` when transitioning to `blocked`
8. Aggregate `shouldAutoTransition` getter delegates to pure function correctly
9. Escalation stored on aggregate props and accessible via `lastEscalation` getter

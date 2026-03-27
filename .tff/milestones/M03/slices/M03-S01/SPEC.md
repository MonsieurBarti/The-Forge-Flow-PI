# M03-S01: WorkflowSession Aggregate + State Machine

## Overview

Build the `WorkflowSession` aggregate root with a declarative transition table, guard functions, pause/resume, and the full workflow state machine. This is the core domain model for the workflow hexagon — it owns phase transitions but does NOT synchronize slice status (deferred to S03).

### Deferred to Other Slices

- **R02 AC "Phase changes synchronized with slice status transitions"** — deferred to S03 (Cross-hexagon event wiring). The workflow emits `WorkflowPhaseChangedEvent`; S03 wires the handler that calls `slice.transitionTo()`.
- **R03 "Escalation object"** — deferred to S02 (Autonomy modes). This slice transitions to `blocked` but does not define a structured escalation DTO.

## Requirements

- R01: WorkflowSession aggregate
- R02: State machine transitions

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Transition table format | Flat rule array | Easier to serialize, test individually, attach guards. Matches R01's "declarative transition table" requirement. |
| Guard mechanism | Pure predicates on context object | Keeps aggregate synchronous and testable. Callers assemble `GuardContext`. |
| Ambiguous resolution | First-match wins | Rules evaluated in order. Predictable, simple, classic FSM semantics. |
| Persistence scope | Repo port + in-memory adapter | Full vertical slice following Slice/Task hexagon pattern. SQLite deferred. |
| Slice sync | Workflow-only | `trigger()` emits `WorkflowPhaseChangedEvent`. Slice transitions are S03's job. |

## Domain Model

### WorkflowSession Aggregate

Extends `AggregateRoot<WorkflowSessionProps>`.

**Props** (extend existing `WorkflowSessionPropsSchema`):
- `id`, `milestoneId`, `sliceId?`, `currentPhase`, `previousPhase?`, `retryCount`, `autonomyMode`, `createdAt`, `updatedAt`

**Factory methods:**
- `createNew(milestoneId, autonomyMode)` — starts at `idle`, emits no event (session creation is infrastructure)
- `reconstitute(props)` — hydrate from persistence, no events

**Cardinality:** One per milestone (enforced at repository level).

### Business Methods

#### `trigger(trigger: WorkflowTrigger, ctx: GuardContext): Result<WorkflowSession, WorkflowBaseError>`

1. Filter `TRANSITION_TABLE` for rules matching `{ from: currentPhase, trigger }`
2. Also include wildcard `*active*` rules if `currentPhase` is an active phase
3. Evaluate guards in order (first-match wins)
4. If no rule matches: return `err(NoMatchingTransitionError)`
5. If all guards fail: return `err(GuardRejectedError)`
6. Apply transition effects (retryCount, previousPhase, sliceId)
7. Update `currentPhase` and `updatedAt`
8. Emit `WorkflowPhaseChangedEvent`
9. Return `ok(this)`

#### `assignSlice(sliceId: string): Result<void, SliceAlreadyAssignedError>`

- Only valid when `sliceId` is null
- Sets `sliceId`

#### `clearSlice(): void`

- Sets `sliceId` to null, resets `retryCount` to 0

### Guard Names

```typescript
GuardNameSchema = z.enum(['notSTier', 'isSTier', 'allSlicesClosed', 'retriesExhausted'])
```

| Guard | Predicate |
|---|---|
| `notSTier` | `ctx.complexityTier !== 'S'` |
| `isSTier` | `ctx.complexityTier === 'S'` |
| `allSlicesClosed` | `ctx.allSlicesClosed === true` |
| `retriesExhausted` | `ctx.retryCount >= ctx.maxRetries` |

### Transition Effects

```typescript
TransitionEffectSchema = z.enum([
  'incrementRetry', 'savePreviousPhase', 'restorePreviousPhase',
  'resetRetryCount', 'clearSlice'
])
```

| Effect | Action |
|---|---|
| `incrementRetry` | `retryCount++` |
| `savePreviousPhase` | `previousPhase = currentPhase` |
| `restorePreviousPhase` | `currentPhase = previousPhase` |
| `resetRetryCount` | `retryCount = 0` |
| `clearSlice` | `sliceId = null` |

## Transition Table

| # | From | Trigger | To | Guard | Effects |
|---|---|---|---|---|---|
| 1 | idle | start | discussing | — | — |
| 2 | discussing | next | researching | notSTier | — |
| 3 | discussing | next | planning | isSTier | — |
| 4 | discussing | skip | planning | — | — |
| 5 | researching | next | planning | — | — |
| 6 | planning | approve | executing | — | resetRetryCount |
| 7 | planning | reject | planning | — | incrementRetry |
| 8 | executing | next | verifying | — | — |
| 9 | verifying | approve | reviewing | — | resetRetryCount |
| 10 | verifying | reject | executing | — | incrementRetry |
| 11 | reviewing | approve | shipping | — | resetRetryCount |
| 12 | reviewing | reject | executing | — | incrementRetry |
| 13 | shipping | next | idle | — | clearSlice, resetRetryCount |
| 14 | idle | next | completing-milestone | allSlicesClosed | — |
| 15 | completing-milestone | next | idle | — | — |
| 16 | *active* | fail | blocked | retriesExhausted | — |
| 17 | *active* | pause | paused | — | savePreviousPhase |
| 18 | paused | resume | *previousPhase* | — | restorePreviousPhase |
| 19 | blocked | abort | idle | — | clearSlice, resetRetryCount |

**`*active*`** = discussing, researching, planning, executing, verifying, reviewing, shipping

**`*previousPhase*`** = dynamically resolved from `previousPhase` field

## Schemas

Extend `workflow-session.schemas.ts` with:

```typescript
GuardNameSchema = z.enum(['notSTier', 'isSTier', 'allSlicesClosed', 'retriesExhausted'])
type GuardName = z.infer<typeof GuardNameSchema>

TransitionEffectSchema = z.enum([
  'incrementRetry', 'savePreviousPhase', 'restorePreviousPhase',
  'resetRetryCount', 'clearSlice'
])
type TransitionEffect = z.infer<typeof TransitionEffectSchema>

GuardContextSchema = z.object({
  complexityTier: ComplexityTierSchema.nullable(),
  retryCount: z.number().int().min(0),
  maxRetries: z.number().int().min(0),
  allSlicesClosed: z.boolean(),
})
type GuardContext = z.infer<typeof GuardContextSchema>

TransitionRuleSchema = z.object({
  from: WorkflowPhaseSchema.or(z.literal('*active*')),
  trigger: WorkflowTriggerSchema,
  to: WorkflowPhaseSchema.or(z.literal('*previousPhase*')),
  guard: GuardNameSchema.optional(),
  effects: z.array(TransitionEffectSchema).default([]),
})
type TransitionRule = z.infer<typeof TransitionRuleSchema>
```

## Events

### WorkflowPhaseChangedEvent

```typescript
Props: {
  ...DomainEventProps,
  milestoneId: string,
  sliceId?: string,
  fromPhase: WorkflowPhase,
  toPhase: WorkflowPhase,
  trigger: WorkflowTrigger,
  retryCount: number,
}
eventName = EVENT_NAMES.WORKFLOW_PHASE_CHANGED
```

## Errors

All extend `BaseDomainError` with code prefix `WORKFLOW.`.

| Error | Code | When |
|---|---|---|
| `WorkflowBaseError` | (abstract) | Base for all workflow errors |
| `NoMatchingTransitionError` | `WORKFLOW.NO_MATCHING_TRANSITION` | No rule matches phase + trigger |
| `GuardRejectedError` | `WORKFLOW.GUARD_REJECTED` | Rules found but all guards fail |
| `SliceAlreadyAssignedError` | `WORKFLOW.SLICE_ALREADY_ASSIGNED` | `assignSlice` when sliceId is set |
| `NoSliceAssignedError` | `WORKFLOW.NO_SLICE_ASSIGNED` | Trigger requiring slice when none assigned |

## Persistence

### WorkflowSessionRepositoryPort

```typescript
abstract class WorkflowSessionRepositoryPort {
  abstract save(session: WorkflowSession): Promise<Result<void, PersistenceError>>
  abstract findById(id: string): Promise<Result<WorkflowSession | null, PersistenceError>>
  abstract findByMilestoneId(milestoneId: string): Promise<Result<WorkflowSession | null, PersistenceError>>
}
```

### InMemoryWorkflowSessionRepository

- `Map<string, WorkflowSessionProps>` store
- Enforces one-per-milestone cardinality on save
- Reconstitutes aggregate on find

## File Layout

```
src/hexagons/workflow/
  domain/
    workflow-session.aggregate.ts       # NEW
    workflow-session.aggregate.spec.ts  # NEW
    workflow-session.builder.ts         # NEW
    workflow-session.schemas.ts         # EXTEND
    transition-table.ts                 # NEW
    transition-table.spec.ts            # NEW
    errors/
      workflow-base.error.ts            # NEW
      no-matching-transition.error.ts   # NEW
      guard-rejected.error.ts           # NEW
      slice-already-assigned.error.ts   # NEW
      no-slice-assigned.error.ts        # NEW
    events/
      workflow-phase-changed.event.ts   # NEW
    ports/
      workflow-session.repository.port.ts  # NEW
  infrastructure/
    in-memory-workflow-session.repository.ts       # NEW
    in-memory-workflow-session.repository.spec.ts  # NEW
  index.ts                              # UPDATE
```

## Acceptance Criteria

1. Declarative transition table (not if-else chains) — all 19 rules in flat array
2. Guard functions: `notSTier`, `isSTier`, `allSlicesClosed`, `retriesExhausted` — pure predicates on `GuardContext`
3. Pause saves `previousPhase`; resume restores it
4. All transitions tested (including back-edges, wildcards, and guards)
5. `retryCount >= maxRetries` triggers transition to `blocked` via `retriesExhausted` guard
6. One `WorkflowSession` per milestone (repository-level enforcement)
7. `WorkflowPhaseChangedEvent` emitted on every successful transition
8. `assignSlice(sliceId)` succeeds when no slice is assigned and returns `SliceAlreadyAssignedError` when one already is
9. `clearSlice()` nullifies `sliceId` and resets `retryCount` to 0

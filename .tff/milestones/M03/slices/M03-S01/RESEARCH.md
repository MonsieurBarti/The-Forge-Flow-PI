# M03-S01: Research Notes

## Existing Patterns Confirmed

All patterns are well-established. No investigation needed. Summary of patterns to follow:

### Aggregate Pattern (from Slice)
- Private constructor + `createNew()` factory + `reconstitute()`
- Constructor passes props + Zod schema to `Entity` base (validates on construction)
- Business methods return `Result<T, E>`
- Events via `addEvent()`, always update `updatedAt`

### Builder Pattern (from SliceBuilder)
- Faker defaults, fluent interface, `build()` calls `createNew()`, `buildProps()` for raw props

### Repository Port (from SliceRepositoryPort)
- Abstract class, all methods `async` returning `Promise<Result<T, PersistenceError>>`
- No delete — save replaces

### In-Memory Repository (from InMemorySliceRepository)
- `Map<string, Props>` store, reconstitutes on retrieval
- Business invariants enforced in `save()` (cardinality for WorkflowSession)
- Helper methods: `seed()`, `reset()`

### Error Pattern (from SliceNotFoundError)
- Extends `BaseDomainError`, readonly `code` with DOMAIN.ACTION pattern, metadata object

### Event Pattern (from SliceCreatedEvent)
- Extends `DomainEvent`, sets `eventName` from `EVENT_NAMES` constant
- Existing events are thin (only base props)

## Findings Requiring Attention

### 1. WorkflowPhaseChangedEvent Needs Extra Props

All existing domain events are thin — they only use `DomainEventProps` (id, aggregateId, occurredAt). The `WorkflowPhaseChangedEvent` needs additional fields: `milestoneId`, `sliceId`, `fromPhase`, `toPhase`, `trigger`, `retryCount`.

**Approach:** Extend the constructor to accept extra props alongside `DomainEventProps`. Define a `WorkflowPhaseChangedEventPropsSchema` that extends `DomainEventPropsSchema`. This is a valid pattern — the base class handles the common fields, the subclass adds domain-specific ones.

### 2. SliceStatusVO Mismatch with Workflow Transitions

The `SliceStatusVO` transition table allows:
- `discussing → researching` (only)

But the workflow transition table has:
- `discussing → researching` (notSTier guard)
- `discussing → planning` (isSTier guard)
- `discussing → planning` (skip trigger)

**Impact:** S-tier slices skip research, so the workflow needs `discussing → planning`. But `SliceStatusVO` doesn't allow it. This is **not a problem for S01** (workflow-only scope), but **S03 will need to update `SliceStatusVO`** to add `discussing → planning` as an allowed transition.

**Action:** Note in SPEC.md deferred items. No changes needed in S01.

### 3. Wildcard Rules in Transition Table

Rules 16-17 use `*active*` as a source phase (pause/fail from any active phase). Implementation needs a set of "active phases" and rule matching must check both exact-match and wildcard rules.

**Approach:** Define `ACTIVE_PHASES` as a `ReadonlySet<WorkflowPhase>` (discussing, researching, planning, executing, verifying, reviewing, shipping). In `trigger()`, filter rules where `rule.from === currentPhase || (rule.from === '*active*' && ACTIVE_PHASES.has(currentPhase))`.

### 4. Dynamic Target in Resume Rule

Rule 18 uses `*previousPhase*` as target. Implementation must resolve this dynamically from `previousPhase` field.

**Approach:** After finding the matching rule, if `rule.to === '*previousPhase*'`, resolve to `this.props.previousPhase`. If `previousPhase` is undefined, return error (cannot resume without saved phase).

## Dependencies

- `@kernel`: AggregateRoot, Entity, ValueObject, DomainEvent, Result, BaseDomainError, InvalidTransitionError, PersistenceError, EVENT_NAMES, IdSchema, TimestampSchema, ComplexityTierSchema
- `@hexagons/settings`: AutonomyModeSchema (already used in existing schemas)
- No new cross-hexagon dependencies needed

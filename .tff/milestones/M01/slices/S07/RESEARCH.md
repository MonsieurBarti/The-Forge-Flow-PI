# M01-S07 Research: Slice Hexagon

## R1: ValueObject Pattern for SliceStatusVO

**Finding:** `ValueObject<TProps>` takes `(props, schema)` in a protected constructor. Props are validated via `schema.parse()`. Equality is structural via `stableStringify`. No existing VO subclasses exist in production code — SliceStatusVO will be the first.

**Design implication:** SliceStatusVO wraps `{ value: SliceStatus }` as its props. The VO is immutable — `transitionTo()` returns a new instance. The transition map is a static `ReadonlyMap<SliceStatus, ReadonlySet<SliceStatus>>`.

```typescript
// Props shape
const SliceStatusVOPropsSchema = z.object({ value: SliceStatusSchema });

// Construction
static create(status: SliceStatus): SliceStatusVO {
  return new SliceStatusVO({ value: status }, SliceStatusVOPropsSchema);
}
```

## R2: Aggregate Patterns from S05/S06

**Finding:** Milestone aggregate uses:
- Private constructor: `private constructor(props) { super(props, Schema); }`
- `createNew()` static factory: hardcodes initial status, emits creation event, returns instance
- `reconstitute()` static method: direct constructor call, no events
- Getters: simple `this.props.x` delegation, one derived getter (`branch`)
- Status transitions: validate precondition, mutate `this.props`, update `updatedAt`, return `Result<void, InvalidTransitionError>`
- Events emitted on creation and terminal transitions only

**Design implication for Slice:**
- `createNew()` hardcodes status to `"discussing"`, emits `SliceCreatedEvent`
- `transitionTo()` delegates to `SliceStatusVO`, then mutates `this.props.status` and `this.props.updatedAt`
- Event emission: `SliceStatusChangedEvent` on all transitions except self-transition (`planning→planning`)
- `classify()` is a simple assignment: compute tier from criteria, set `this.props.complexity`, update `updatedAt`
- Nullable fields (`complexity`, `specPath`, `planPath`, `researchPath`) default to `null`

## R3: Builder Pattern

**Finding:** MilestoneBuilder uses:
- Private fields with Faker defaults (`faker.string.uuid()`, `faker.lorem.words(3)`, etc.)
- Fluent `with*()` methods returning `this`
- `build()` calls `createNew()` — status field is **ignored** (always initial state)
- `buildProps()` returns raw props for reconstitution tests (allows any status)
- Label defaults to hardcoded value (`"M01"`)

**Design implication for SliceBuilder:**
- Default label: `"M01-S01"` (hardcoded, common test case)
- `build()` calls `Slice.createNew()` — always produces `"discussing"` status
- `buildProps()` allows setting any status/complexity for reconstitution tests
- `withComplexity()`, `withSpecPath()`, `withPlanPath()`, `withResearchPath()` set nullable fields

## R4: Repository + Contract Test Pattern

**Finding:** InMemoryMilestoneRepository uses:
- `Map<string, MilestoneProps>` storage
- `toJSON()` for serialization, `reconstitute()` for deserialization
- Label uniqueness enforced in `save()`: iterate all entries, check for label collision on different ID
- `seed()` and `reset()` test helpers
- SQLite stub throws `Error("Not implemented")` for all methods

Contract tests use a factory function pattern:
```typescript
function runContractTests(
  name: string,
  factory: () => RepoPort & { reset(): void },
)
```
- `beforeEach` creates fresh instance and calls `reset()`
- Tests: roundtrip (save+find), null for unknowns, collection queries, label uniqueness, update existing
- Result inspection via `isOk()`/`isErr()` guards

**Design implication for Slice:**
- Mirror exact pattern: `Map<string, SliceProps>`, same factory test shape
- Port methods: `save`, `findById`, `findByLabel`, `findByMilestoneId` (replaces `findByProjectId`)
- Label uniqueness in `save()`, same error pattern

## R5: Domain Event Pattern

**Finding:** Events are thin subclasses of `DomainEvent` with a readonly `eventName` property assigned from `EVENT_NAMES` constants. `SLICE_CREATED` and `SLICE_STATUS_CHANGED` already exist in `EVENT_NAMES`.

**Design implication:** Direct mirror — two event classes, no additional payload beyond what `DomainEvent` base provides.

## R6: State Machine Transition Map

**Confirmed 10 valid transitions:**

| From | To | Type |
|------|-----|------|
| discussing | researching | forward |
| researching | planning | forward |
| planning | planning | self (back-edge) |
| planning | executing | forward |
| executing | verifying | forward |
| verifying | executing | back-edge |
| verifying | reviewing | forward |
| reviewing | executing | back-edge |
| reviewing | completing | forward |
| completing | closed | forward |

**Invalid transitions to test:** any not in the table above. Key cases: discussing→closed, closed→anything, executing→planning, backward skips.

## R7: Kernel Dependencies Available

All needed kernel exports confirmed present:
- `AggregateRoot`, `ValueObject`, `DomainEvent`
- `IdSchema`, `TimestampSchema`
- `InvalidTransitionError`, `BaseDomainError`, `PersistenceError`
- `EVENT_NAMES` (includes `SLICE_CREATED`, `SLICE_STATUS_CHANGED`)
- `Result`, `ok`, `err`, `isOk`, `isErr`

No kernel changes needed for S07.

## Open Risks

None. All patterns are established and dependencies are in place.

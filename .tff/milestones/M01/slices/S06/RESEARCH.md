# M01-S06: Milestone Hexagon — Research

## 1. Kernel Error Pattern for InvalidTransitionError

### BaseDomainError constructor
```typescript
constructor(message: string, metadata?: Record<string, unknown>)
```
- Abstract `code: string` property — subclasses must set it
- `name` auto-set to `this.constructor.name`

### Two patterns exist

| Pattern | Example | When to use |
|---------|---------|-------------|
| **Static code** | `PersistenceError` — `readonly code = "PERSISTENCE.FAILURE"` | Single error type, no parameterization |
| **Dynamic code** | `GitError` — takes `code` param, prefixes `GIT.${code}` | Family of related errors |

### Decision for InvalidTransitionError

Use **static code** pattern — there's only one transition error code. The `from`/`to`/`entity` context goes in `metadata`:

```typescript
export class InvalidTransitionError extends BaseDomainError {
  readonly code = "DOMAIN.INVALID_TRANSITION";

  constructor(from: string, to: string, entity: string) {
    super(`Invalid transition from '${from}' to '${to}' on ${entity}`, { from, to, entity });
  }
}
```

### Integration points
- Add to `src/kernel/errors/invalid-transition.error.ts`
- Re-export from `src/kernel/errors/index.ts`
- Re-export from `src/kernel/index.ts`

## 2. Entity / AggregateRoot Patterns

### Entity constructor
```typescript
protected constructor(protected props: TProps, schema: ZodType<TProps>)
```
- Zod `schema.parse(props)` runs in constructor — throws on invalid
- `toJSON()` returns `{ ...this.props }` (shallow copy)
- Abstract `id` getter required

### AggregateRoot adds
- `protected addEvent(event: DomainEvent): void`
- `pullEvents(): DomainEvent[]` — drains and returns

### DomainEvent constructor
```typescript
constructor(props: DomainEventProps)  // { id, aggregateId, occurredAt, correlationId?, causationId? }
```
- Abstract `eventName: EventName` required on subclass

### Schemas
- `IdSchema` = `z.uuid()` — yields `string`
- `TimestampSchema` = `z.coerce.date()` — yields `Date`

### Key: props are mutable on Entity
Entity props are `protected` (not `readonly`), so `activate()` and `close()` can mutate `this.props.status` and `this.props.updatedAt` directly — same pattern as `Project.updateVision()`.

## 3. Test Patterns

### Aggregate spec pattern
- Top-level `describe("Milestone")` with nested `describe` per method
- Setup: `id`, `projectId`, `now` at describe scope
- Each `it()` is a single focused assertion
- Event verification: `milestone.pullEvents()` → check `eventName`, `aggregateId`
- Reconstitution: `reconstitute()` does not emit events

### Contract test pattern
```typescript
function runContractTests(
  name: string,
  factory: () => MilestoneRepositoryPort & { reset(): void }
) {
  describe(name, () => {
    let repo: MilestoneRepositoryPort & { reset(): void };
    beforeEach(() => { repo = factory(); repo.reset(); });
    // tests using isOk()/isErr() from @kernel
  });
}

runContractTests("InMemoryMilestoneRepository", () => new InMemoryMilestoneRepository());
```

### Stub pattern
- Extends port, all methods throw `Error("Not implemented")`

### Contract test cases for Milestone
1. save + findById roundtrip
2. save + findByLabel roundtrip
3. findByProjectId returns matching milestones
4. findByProjectId returns empty array when none match
5. findById returns null for unknown id
6. findByLabel returns null for unknown label
7. Label uniqueness: save rejects when a different milestone has the same label
8. save allows updating an existing milestone (same id)

## 4. Status Transition Logic

Linear state machine — no need for a ValueObject:

```
open ──activate()──> in_progress ──close()──> closed
```

Implementation in aggregate methods:
```typescript
activate(now: Date): Result<void, InvalidTransitionError> {
  if (this.props.status !== "open") {
    return err(new InvalidTransitionError(this.props.status, "in_progress", "Milestone"));
  }
  this.props.status = "in_progress";
  this.props.updatedAt = now;
  return ok(undefined);
}
```

No events on `activate()` (not in R05). Events on `createNew()` and `close()` only.

## 5. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Adding `InvalidTransitionError` to kernel could break existing tests | Run full test suite after kernel change — error is additive, no breaking changes |
| Label regex `^M\d{2,}$` might be too strict for edge cases | Matches all labels in current use (`M01`-`M99`, `M100+`). Can relax later if needed. |
| `findByProjectId` returning `Milestone[]` (not paginated) | Fine for now — a project will never have hundreds of milestones |

# Research -- M04-S01: Checkpoint Entity + Repository

## Established Patterns

### AggregateRoot

**File:** `src/kernel/aggregate-root.base.ts`

- Extends `Entity<TProps>` which validates props via Zod schema in constructor
- Domain events tracked internally, pulled via `pullEvents()` (resets after pull)
- Constructor: `private constructor(props: TProps)` then `super(props, schema)`
- Must implement `abstract get id(): string`
- `reconstitute(props)` -- static factory for loading (no events)
- `createNew(params)` -- static factory for creation (with events)

### Entity Base

**File:** `src/kernel/entity.base.ts`

```typescript
protected constructor(protected props: TProps, schema: ZodType<TProps>) {
  this.props = schema.parse(props);
}
abstract get id(): string;
toJSON(): TProps { return { ...this.props }; }
```

### Repository Port + Adapter

**Port pattern** (`hexagons/{entity}/domain/ports/{entity}-repository.port.ts`):
- Abstract class, async methods, return `Result<T, PersistenceError>`
- Keyed by domain identifier (id or sliceId)

**InMemory adapter** (`hexagons/{entity}/infrastructure/in-memory-{entity}.repository.ts`):
- `Map<string, Props>` store keyed by identifier
- `seed(aggregate)` + `reset()` for test setup
- Validates business constraints in `save()`, returns `PersistenceError` on violation
- Deserializes via `Aggregate.reconstitute(props)`

**Contract tests** (`hexagons/{entity}/infrastructure/{entity}-repository.contract.spec.ts`):
```typescript
function runContractTests(name: string, factory: () => Port & { reset(): void }) {
  describe(`${name} contract`, () => { /* ... */ });
}
runContractTests("InMemory...", () => new InMemory...());
```

### Domain Events

**Kernel:** `src/kernel/event-names.ts`
- `EVENT_NAMES` const object, `EventName` type, `EventNameSchema` z.enum
- Naming: `domain.action` (e.g., `execution.checkpoint-saved`)

**Concrete event pattern:**
```typescript
class SomeEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.SOME_EVENT;
}
```

Extended events add fields via `DomainEventPropsSchema.extend({...})` and assign in constructor.

### Domain Errors

**Base:** `src/kernel/errors/base-domain.error.ts`
- `abstract readonly code: string` (format: `ENTITY.ERROR_NAME`)
- Constructor: `super(message, metadata?)`
- Located at `domain/errors/{error-name}.error.ts`

### Builder

**Pattern** (`hexagons/{entity}/domain/{entity}.builder.ts`):
- Private `_field` per prop, initialized with faker defaults
- Fluent `with*(value): this` methods
- `build()` calls `Aggregate.createNew()` (with events)
- `buildProps()` returns raw props (no events)

### Schemas

**Pattern** (`hexagons/{entity}/domain/{entity}.schemas.ts`):
- Import `IdSchema`, `TimestampSchema` from `@kernel`
- Export `PropsSchema` + `Props` type + `DTO` type alias
- Optional fields: `.default()` or `.nullable().default(null)`

### Barrel Exports

**Pattern** (`hexagons/{entity}/index.ts`):
- Grouped by category: Application, Domain -- Errors, Domain -- Events, Domain -- Ports, Domain -- Schemas
- Export types with `export type` for pure types

## Integration Points

### Execution Hexagon

`src/hexagons/execution/` does NOT exist yet. M04-S01 creates it as the first execution hexagon entity.

**Directory structure to create:**
```
hexagons/execution/
  domain/
    checkpoint.schemas.ts
    checkpoint.schemas.spec.ts
    checkpoint.aggregate.ts
    checkpoint.aggregate.spec.ts
    checkpoint.builder.ts
    errors/
      checkpoint-not-found.error.ts
      invalid-checkpoint-state.error.ts
    events/
      checkpoint-saved.event.ts
    ports/
      checkpoint-repository.port.ts
  infrastructure/
    in-memory-checkpoint.repository.ts
    in-memory-checkpoint.repository.spec.ts
    markdown-checkpoint.repository.ts
    markdown-checkpoint.repository.spec.ts
    checkpoint-repository.contract.spec.ts
  index.ts
```

### Kernel Modifications

- Add `CHECKPOINT_SAVED: "execution.checkpoint-saved"` to `EVENT_NAMES` in `src/kernel/event-names.ts`
- Add to `EventNameSchema` z.enum array
- Update `event-names.spec.ts`

### Path Aliases

Check `tsconfig.json` for `@hexagons/execution` -- may need to add path mapping if not wildcard-based.

### Dependencies

- `@kernel` -- AggregateRoot, Entity, DomainEvent, Result, IdSchema, TimestampSchema, BaseDomainError, PersistenceError
- `zod` -- schema definitions
- `@faker-js/faker` -- builder defaults (devDependency)
- `vitest` -- test framework (devDependency)
- No cross-hexagon dependencies (standalone)

## Key Decisions from SPEC

| Decision | Rationale |
|----------|-----------|
| Markdown storage over SQLite | File-based survives SQLite corruption (the failure mode checkpoints protect against) |
| No `CheckpointCreatedEvent` | Internal execution state; observable via journal (M04-S02) |
| `completedAt` uses `.nullable().default(null)` not `.optional()` | JSON roundtrip: JSON has `null` but not `undefined` |
| Keyed by `sliceId` not `id` | One checkpoint per slice; use case always looks up by slice |
| Path resolver injected into MarkdownCheckpointRepository | Avoids cross-hexagon import; composition root wires the resolver |
| Atomic write via `.tmp` + rename | POSIX atomic write for crash safety |

## Risks

| Risk | Mitigation |
|------|------------|
| First execution hexagon -- no prior art for this hexagon's barrel exports | Follow task/slice hexagon patterns exactly |
| MarkdownCheckpointRepository needs fs operations | Use `node:fs/promises` with atomic write pattern |
| HTML comment parsing could be brittle | Use simple regex `<!-- CHECKPOINT_JSON\n(.*)\n-->` with single `JSON.parse` |

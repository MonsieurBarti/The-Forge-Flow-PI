# M01-S02: Kernel Base Classes

## Scope

Implement the foundational DDD building blocks in `src/kernel/`: Entity, AggregateRoot, ValueObject, DomainEvent, Result type, and the shared schemas (IdSchema, TimestampSchema) they depend on. All base classes validate props via Zod in their constructors.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| IdSchema/TimestampSchema location | S02 (`kernel/schemas.ts`) | DomainEventPropsSchema needs them; fundamental enough to live with base classes |
| Zod validation in constructors | Yes — base class validates | Every instantiation is safe; subclass passes its schema to `super()` |
| Result type | Plain discriminated union + standalone functions | Idiomatic TS, no wrapper class overhead |
| ValueObject equality | `JSON.stringify` with sorted keys | Deterministic, no external dependency |
| Entity generic signature | `Entity<TProps>` with schema as constructor arg | Keeps generic simple; schema is a runtime concern, not a type param |

## Deliverables

### 1. `src/kernel/schemas.ts` — Shared Kernel Schemas

```typescript
export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

export const TimestampSchema = z.coerce.date();
export type Timestamp = z.infer<typeof TimestampSchema>;
```

### 2. `src/kernel/result.ts` — Result Type

```typescript
export type Result<T, E> = { ok: true; data: T } | { ok: false; error: E };

export function ok<T>(data: T): Result<T, never>;
export function err<E>(error: E): Result<never, E>;
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; data: T };
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E };
export function match<T, E, R>(result: Result<T, E>, handlers: { ok: (data: T) => R; err: (error: E) => R }): R;
```

### 3. `src/kernel/entity.base.ts` — Entity Base

```typescript
export abstract class Entity<TProps> {
  protected constructor(protected props: TProps, schema: ZodType<TProps>) {
    this.props = schema.parse(props);
  }
  abstract get id(): string;
  toJSON(): TProps { return { ...this.props }; }
}
```

### 4. `src/kernel/aggregate-root.base.ts` — AggregateRoot Base

```typescript
export abstract class AggregateRoot<TProps> extends Entity<TProps> {
  private domainEvents: DomainEvent[] = [];
  protected addEvent(event: DomainEvent): void { this.domainEvents.push(event); }
  pullEvents(): DomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents = [];
    return events;
  }
}
```

### 5. `src/kernel/value-object.base.ts` — ValueObject Base

```typescript
export abstract class ValueObject<TProps> {
  protected constructor(protected readonly props: TProps, schema: ZodType<TProps>) {
    this.props = schema.parse(props);
  }
  equals(other: ValueObject<TProps>): boolean {
    return stableStringify(this.props) === stableStringify(other.props);
  }
}
```

`stableStringify` — private helper that sorts object keys before `JSON.stringify`.

### 6. `src/kernel/domain-event.base.ts` — DomainEvent Base

```typescript
export const DomainEventPropsSchema = z.object({
  id: IdSchema,
  aggregateId: IdSchema,
  occurredAt: TimestampSchema,
  correlationId: IdSchema.optional(),
  causationId: IdSchema.optional(),
});
export type DomainEventProps = z.infer<typeof DomainEventPropsSchema>;

export abstract class DomainEvent {
  abstract readonly eventName: string;
  public readonly id: Id;
  public readonly aggregateId: Id;
  public readonly occurredAt: Timestamp;
  public readonly correlationId?: Id;
  public readonly causationId?: Id;
  constructor(props: DomainEventProps) {
    const parsed = DomainEventPropsSchema.parse(props);
    this.id = parsed.id;
    this.aggregateId = parsed.aggregateId;
    this.occurredAt = parsed.occurredAt;
    this.correlationId = parsed.correlationId;
    this.causationId = parsed.causationId;
  }
}
```

### 7. `src/kernel/index.ts` — Updated Barrel

Re-export all public symbols from schemas, result, entity, aggregate-root, value-object, domain-event.

## Acceptance Criteria

- [x] AC1: All base classes are generic, Zod-validated in constructors, and independently unit-tested
- [x] AC2: Result type used as discriminated union with `ok()`, `err()`, `isOk()`, `isErr()`, `match()` — all tested
- [x] AC3: `ValueObject.equals()` uses deterministic structural comparison — tested with same/different props
- [x] AC4: `AggregateRoot.pullEvents()` returns collected events and clears the internal list — tested
- [x] AC5: `DomainEvent` validates props against `DomainEventPropsSchema` — tested with valid and invalid props
- [x] AC6: `biome check`, `vitest run`, `tsc --noEmit` all pass

## File Map

| File | Type | Description |
|------|------|-------------|
| `src/kernel/schemas.ts` | Source | IdSchema, TimestampSchema |
| `src/kernel/schemas.spec.ts` | Test | Schema validation tests |
| `src/kernel/result.ts` | Source | Result type + utility functions |
| `src/kernel/result.spec.ts` | Test | Result utilities tests |
| `src/kernel/entity.base.ts` | Source | Entity abstract base |
| `src/kernel/entity.base.spec.ts` | Test | Entity tests (via concrete stub) |
| `src/kernel/aggregate-root.base.ts` | Source | AggregateRoot base |
| `src/kernel/aggregate-root.base.spec.ts` | Test | AggregateRoot + event tests |
| `src/kernel/value-object.base.ts` | Source | ValueObject base |
| `src/kernel/value-object.base.spec.ts` | Test | Equality tests |
| `src/kernel/domain-event.base.ts` | Source | DomainEvent base + schema |
| `src/kernel/domain-event.base.spec.ts` | Test | DomainEvent validation tests |
| `src/kernel/index.ts` | Source | Barrel re-exports |

## Unknowns

None — all resolved during discussion.

## Complexity

**F-lite** — 13 files (7 source + 6 test), no investigation needed, clear patterns from design spec.

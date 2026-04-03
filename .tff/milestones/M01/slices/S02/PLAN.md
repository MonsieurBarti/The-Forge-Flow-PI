# M01-S02 Plan: Kernel Base Classes

## Wave 0 (parallel — no dependencies)

### T01: Create kernel schemas

- **File**: `src/kernel/schemas.ts`
- **Code**:
```typescript
import { z } from "zod";

export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

export const TimestampSchema = z.coerce.date();
export type Timestamp = z.infer<typeof TimestampSchema>;
```
- **Test file**: `src/kernel/schemas.spec.ts`
- **Test cases**:
  - IdSchema accepts valid UUID
  - IdSchema rejects non-UUID string
  - TimestampSchema coerces ISO string to Date
  - TimestampSchema coerces number (epoch ms) to Date
  - TimestampSchema accepts Date object
  - TimestampSchema rejects invalid string
- **Run**: `npx vitest run src/kernel/schemas.spec.ts`
- **Expect**: All tests pass
- **AC**: AC1

### T02: Create Result type and utilities

- **File**: `src/kernel/result.ts`
- **Code**:
```typescript
export type Result<T, E> = { ok: true; data: T } | { ok: false; error: E };

export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; data: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

export function match<T, E, R>(
  result: Result<T, E>,
  handlers: { ok: (data: T) => R; err: (error: E) => R },
): R {
  return result.ok ? handlers.ok(result.data) : handlers.err(result.error);
}
```
- **Test file**: `src/kernel/result.spec.ts`
- **Test cases**:
  - `ok()` creates success result
  - `err()` creates failure result
  - `isOk()` narrows to success
  - `isErr()` narrows to failure
  - `match()` calls ok handler on success
  - `match()` calls err handler on failure
- **Run**: `npx vitest run src/kernel/result.spec.ts`
- **Expect**: All tests pass
- **AC**: AC2

## Wave 1 (parallel — depends on Wave 0, needs schemas)

### T03: Create Entity base class

- **File**: `src/kernel/entity.base.ts`
- **Code**:
```typescript
import type { ZodType } from "zod";

export abstract class Entity<TProps> {
  protected constructor(
    protected props: TProps,
    schema: ZodType<TProps>,
  ) {
    this.props = schema.parse(props);
  }

  abstract get id(): string;

  toJSON(): TProps {
    return { ...this.props };
  }
}
```
- **Test file**: `src/kernel/entity.base.spec.ts`
- **Test strategy**: Create a concrete `TestEntity` stub with a simple Zod schema in the test file
- **Test cases**:
  - Constructs with valid props
  - Throws ZodError on invalid props
  - `id` accessor returns the id from props
  - `toJSON()` returns a shallow copy (not same reference)
- **Run**: `npx vitest run src/kernel/entity.base.spec.ts`
- **Expect**: All tests pass
- **AC**: AC1

### T04: Create ValueObject base class

- **File**: `src/kernel/value-object.base.ts`
- **Code**:
```typescript
import type { ZodType } from "zod";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const sorted = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${sorted.join(",")}}`;
}

export abstract class ValueObject<TProps> {
  protected constructor(
    protected readonly props: TProps,
    schema: ZodType<TProps>,
  ) {
    this.props = schema.parse(props);
  }

  equals(other: ValueObject<TProps>): boolean {
    return stableStringify(this.props) === stableStringify(other.props);
  }
}
```
- **Test file**: `src/kernel/value-object.base.spec.ts`
- **Test strategy**: Create a concrete `TestVO` stub with a Zod schema
- **Test cases**:
  - Constructs with valid props
  - Throws ZodError on invalid props
  - `equals()` returns true for same props
  - `equals()` returns true for same props in different key order
  - `equals()` returns false for different props
  - `equals()` handles nested objects deterministically
- **Run**: `npx vitest run src/kernel/value-object.base.spec.ts`
- **Expect**: All tests pass
- **AC**: AC1, AC3

## Wave 2 (parallel — depends on Wave 1, needs Entity + schemas)

### T05: Create DomainEvent base class

- **File**: `src/kernel/domain-event.base.ts`
- **Code**:
```typescript
import { z } from "zod";
import { IdSchema, TimestampSchema } from "./schemas.js";
import type { Id, Timestamp } from "./schemas.js";

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
- **Test file**: `src/kernel/domain-event.base.spec.ts`
- **Test strategy**: Create a concrete `TestEvent` stub
- **Test cases**:
  - Constructs with valid props (all fields)
  - Constructs with optional fields omitted
  - Throws ZodError on invalid id (not UUID)
  - Throws ZodError on invalid aggregateId
  - Coerces ISO string occurredAt to Date
  - Individual properties are accessible (id, aggregateId, occurredAt, correlationId, causationId)
  - `eventName` is accessible on subclass
- **Run**: `npx vitest run src/kernel/domain-event.base.spec.ts`
- **Expect**: All tests pass
- **AC**: AC1, AC5

### T06: Create AggregateRoot base class

- **File**: `src/kernel/aggregate-root.base.ts`
- **Code**:
```typescript
import type { ZodType } from "zod";
import type { DomainEvent } from "./domain-event.base.js";
import { Entity } from "./entity.base.js";

export abstract class AggregateRoot<TProps> extends Entity<TProps> {
  private domainEvents: DomainEvent[] = [];

  protected addEvent(event: DomainEvent): void {
    this.domainEvents.push(event);
  }

  pullEvents(): DomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents = [];
    return events;
  }
}
```
- **Test file**: `src/kernel/aggregate-root.base.spec.ts`
- **Test strategy**: Create concrete `TestAggregate` + `TestEvent` stubs
- **Test cases**:
  - Constructs with valid props (inherits Entity validation)
  - `pullEvents()` returns empty array when no events added
  - `addEvent()` + `pullEvents()` returns the added events
  - `pullEvents()` clears the internal list (second call returns empty)
  - Multiple events are returned in order
- **Run**: `npx vitest run src/kernel/aggregate-root.base.spec.ts`
- **Expect**: All tests pass
- **AC**: AC1, AC4

## Wave 3 (depends on Wave 2 — barrel + full verification)

### T07: Update kernel barrel and verify all AC

- **File**: `src/kernel/index.ts`
- **Code**:
```typescript
export { IdSchema, TimestampSchema } from "./schemas.js";
export type { Id, Timestamp } from "./schemas.js";

export { ok, err, isOk, isErr, match } from "./result.js";
export type { Result } from "./result.js";

export { Entity } from "./entity.base.js";
export { AggregateRoot } from "./aggregate-root.base.js";
export { ValueObject } from "./value-object.base.js";

export { DomainEvent, DomainEventPropsSchema } from "./domain-event.base.js";
export type { DomainEventProps } from "./domain-event.base.js";
```
- **Run**:
```bash
npx biome check . && npx vitest run && npx tsc --noEmit
```
- **Expect**: All three commands pass, all tests green
- **AC**: AC1, AC2, AC3, AC4, AC5, AC6

### T08: Commit kernel base classes

- **Run**:
```bash
git add src/kernel/
git commit -m "feat(m01-s02): kernel base classes with Zod validation"
```
- **Expect**: Clean commit on milestone/M01 branch
- **AC**: All

## AC Traceability

| AC | Tasks |
|----|-------|
| AC1: Base classes generic, Zod-validated, unit-tested | T01, T03, T04, T05, T06, T07 |
| AC2: Result type with utilities tested | T02, T07 |
| AC3: ValueObject structural equality tested | T04, T07 |
| AC4: AggregateRoot pullEvents tested | T06, T07 |
| AC5: DomainEvent validates against schema | T05, T07 |
| AC6: biome + vitest + tsc pass | T07 |

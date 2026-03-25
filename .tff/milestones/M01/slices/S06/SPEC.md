# M01-S06: Milestone Hexagon

## Problem

The Milestone hexagon needs to be built following the pattern established by the Project hexagon (S05). Milestone is the second aggregate, introducing status transitions (`open -> in_progress -> closed`) and label-based lookups — patterns that Slice (S07) will amplify with its full state machine.

## Approach

Mirror S05's flat hexagon structure. Status transitions use `Result<void, InvalidTransitionError>` rather than thrown exceptions. `InvalidTransitionError` is added to the kernel since S07 also needs it. Branch name is a derived getter, not stored. Label uniqueness is enforced in the repository contract.

## Design

### Directory Structure

```
src/hexagons/milestone/
  domain/
    milestone.schemas.ts
    milestone-created.event.ts
    milestone-closed.event.ts
    milestone.aggregate.ts
    milestone.aggregate.spec.ts
    milestone-repository.port.ts
    milestone.builder.ts
  infrastructure/
    in-memory-milestone.repository.ts
    sqlite-milestone.repository.ts
    milestone-repository.contract.spec.ts
  index.ts
```

### Kernel Addition

```typescript
// kernel/errors/invalid-transition.error.ts
export class InvalidTransitionError extends BaseDomainError {
  constructor(from: string, to: string, entity: string) {
    super(`Invalid transition from '${from}' to '${to}' on ${entity}`, {
      code: "DOMAIN.INVALID_TRANSITION",
      metadata: { from, to, entity },
    });
  }
}
```

Exported from `kernel/errors/index.ts` and `kernel/index.ts`.

### Schemas

```typescript
// domain/milestone.schemas.ts
import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const MilestoneStatusSchema = z.enum(["open", "in_progress", "closed"]);
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>;

export const MilestoneLabelSchema = z.string().regex(/^M\d{2,}$/);
export type MilestoneLabel = z.infer<typeof MilestoneLabelSchema>;

export const MilestonePropsSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  label: MilestoneLabelSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  status: MilestoneStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type MilestoneProps = z.infer<typeof MilestonePropsSchema>;
export type MilestoneDTO = MilestoneProps;
```

### Aggregate Root

```typescript
// domain/milestone.aggregate.ts
export class Milestone extends AggregateRoot<MilestoneProps> {
  private constructor(props: MilestoneProps) {
    super(props, MilestonePropsSchema);
  }

  get id(): string;
  get projectId(): string;
  get label(): string;
  get title(): string;
  get description(): string;
  get status(): MilestoneStatus;
  get branch(): string; // derived: `milestone/${this.label}`
  get createdAt(): Date;
  get updatedAt(): Date;

  static createNew(params: {
    id: Id; projectId: Id; label: string;
    title: string; description?: string; now: Date;
  }): Milestone;
  // Sets status to "open", emits MilestoneCreatedEvent

  activate(now: Date): Result<void, InvalidTransitionError>;
  // open -> in_progress only

  close(now: Date): Result<void, InvalidTransitionError>;
  // in_progress -> closed only, emits MilestoneClosedEvent

  static reconstitute(props: MilestoneProps): Milestone;
}
```

### Domain Events

```typescript
// domain/milestone-created.event.ts
export class MilestoneCreatedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.MILESTONE_CREATED;
}

// domain/milestone-closed.event.ts
export class MilestoneClosedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.MILESTONE_CLOSED;
}
```

### Repository Port

```typescript
// domain/milestone-repository.port.ts
export abstract class MilestoneRepositoryPort {
  abstract save(milestone: Milestone): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Milestone | null, PersistenceError>>;
  abstract findByLabel(label: string): Promise<Result<Milestone | null, PersistenceError>>;
  abstract findByProjectId(projectId: Id): Promise<Result<Milestone[], PersistenceError>>;
}
```

Label uniqueness: `save()` returns `err(PersistenceError)` if a different milestone with the same label exists.

### InMemoryMilestoneRepository

```typescript
// infrastructure/in-memory-milestone.repository.ts
export class InMemoryMilestoneRepository extends MilestoneRepositoryPort {
  private store = new Map<string, MilestoneProps>();

  seed(milestone: Milestone): void;
  reset(): void;
}
```

### SqliteMilestoneRepository (Stub)

```typescript
// infrastructure/sqlite-milestone.repository.ts
export class SqliteMilestoneRepository extends MilestoneRepositoryPort {
  // All methods throw 'Not implemented'
}
```

### Builder

```typescript
// domain/milestone.builder.ts
export class MilestoneBuilder {
  withId(id: string): this;
  withProjectId(projectId: string): this;
  withLabel(label: string): this;
  withTitle(title: string): this;
  withDescription(description: string): this;
  withStatus(status: MilestoneStatus): this;
  build(): Milestone;       // uses createNew() — always status "open"
  buildProps(): MilestoneProps; // raw props for reconstitution tests
}
```

### Barrel Export

```typescript
// index.ts
export type { MilestoneDTO, MilestoneStatus } from "./domain/milestone.schemas";
export { MilestonePropsSchema, MilestoneStatusSchema, MilestoneLabelSchema } from "./domain/milestone.schemas";
export { MilestoneRepositoryPort } from "./domain/milestone-repository.port";
export { MilestoneCreatedEvent } from "./domain/milestone-created.event";
export { MilestoneClosedEvent } from "./domain/milestone-closed.event";
// Milestone aggregate is NOT exported (internal to hexagon)
```

### Contract Tests

- save + findById roundtrip
- save + findByLabel roundtrip
- findByProjectId returns matching milestones
- findByProjectId returns empty array when none match
- findById returns null for unknown id
- findByLabel returns null for unknown label
- label uniqueness: save rejects when a different milestone with the same label exists
- save allows updating an existing milestone (same id, same label)

## Acceptance Criteria

- [x] AC1: `Milestone.createNew()` creates a valid milestone with status `open` and emits `MilestoneCreatedEvent`
- [x] AC2: `Milestone.activate()` transitions `open -> in_progress`, rejects other states with `InvalidTransitionError`
- [x] AC3: `Milestone.close()` transitions `in_progress -> closed` and emits `MilestoneClosedEvent`, rejects other states
- [x] AC4: `Milestone.branch` returns `milestone/${label}` (derived, not stored)
- [x] AC5: `Milestone.reconstitute()` hydrates from props without emitting events
- [x] AC6: Label validation enforces `M{nn}` format via Zod regex
- [x] AC7: Label uniqueness enforced in repository: save rejects duplicate labels on different milestones
- [x] AC8: InMemoryMilestoneRepository passes all contract tests
- [x] AC9: InMemoryMilestoneRepository has `seed()` and `reset()` test helpers
- [x] AC10: SqliteMilestoneRepository stub exists with correct interface
- [x] AC11: MilestoneBuilder produces valid Milestones with Faker defaults
- [x] AC12: `InvalidTransitionError` added to kernel errors with code `DOMAIN.INVALID_TRANSITION`
- [x] AC13: Barrel exports only ports, events, schemas, and DTOs (not the aggregate)
- [x] AC14: All tests pass: aggregate, builder, contract suite
- [x] AC15: `biome check` passes on all new files

## Non-Goals

- Working SQLite adapter (stubbed only)
- Application-layer use cases
- Cross-hexagon wiring (Milestone <-> Project referential integrity)
- `MilestoneActivatedEvent` (not in R05)
- Reopening closed milestones

## Dependencies

- kernel/ base classes (AggregateRoot, DomainEvent, Result, schemas, errors, event names)
- S05 patterns (hexagon structure, contract tests, barrel exports)

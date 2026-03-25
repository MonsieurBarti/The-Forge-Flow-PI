# M01-S07: Slice Hexagon

## Problem

The third and most complex hexagon in M01. Slice introduces an 8-state state machine with back-edges, a value object for status transitions, and a complexity classification system based on architectural impact, requirement clarity, and domain scope — not file count alone.

## Approach

Mirror the S05/S06 hexagon structure. State machine logic is encapsulated in `SliceStatusVO` (a `ValueObject` subclass), keeping the aggregate thin. `InvalidTransitionError` is reused from the kernel. Complexity classification uses a structured criteria object evaluated against the three-axis tier system (architecture impact, requirement clarity, domain scope). SQLite adapter stubbed as in prior slices.

## Design

### Directory Structure

```
src/hexagons/slice/
  domain/
    slice.schemas.ts
    slice-status.vo.ts
    slice-status.vo.spec.ts
    slice-created.event.ts
    slice-status-changed.event.ts
    slice-not-found.error.ts
    slice.aggregate.ts
    slice.aggregate.spec.ts
    slice-repository.port.ts
    slice.builder.ts
  infrastructure/
    in-memory-slice.repository.ts
    sqlite-slice.repository.ts
    slice-repository.contract.spec.ts
  index.ts
```

### Schemas

```typescript
// domain/slice.schemas.ts
import { z } from "zod";
import { IdSchema, TimestampSchema } from "@kernel";

export const SliceStatusSchema = z.enum([
  "discussing",
  "researching",
  "planning",
  "executing",
  "verifying",
  "reviewing",
  "completing",
  "closed",
]);
export type SliceStatus = z.infer<typeof SliceStatusSchema>;

export const SliceLabelSchema = z.string().regex(/^M\d{2,}-S\d{2,}$/);
export type SliceLabel = z.infer<typeof SliceLabelSchema>;

export const ArchitectureImpactSchema = z.enum(["none", "low", "high"]);
export type ArchitectureImpact = z.infer<typeof ArchitectureImpactSchema>;

export const RequirementClaritySchema = z.enum(["clear", "partial", "unclear"]);
export type RequirementClarity = z.infer<typeof RequirementClaritySchema>;

export const DomainScopeSchema = z.enum(["single", "dual", "multi"]);
export type DomainScope = z.infer<typeof DomainScopeSchema>;

export const ComplexityCriteriaSchema = z.object({
  architectureImpact: ArchitectureImpactSchema,
  requirementClarity: RequirementClaritySchema,
  domainScope: DomainScopeSchema,
});
export type ComplexityCriteria = z.infer<typeof ComplexityCriteriaSchema>;

export const ComplexityTierSchema = z.enum(["S", "F-lite", "F-full"]);
export type ComplexityTier = z.infer<typeof ComplexityTierSchema>;

export const SlicePropsSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema,
  label: SliceLabelSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  status: SliceStatusSchema,
  complexity: ComplexityTierSchema.nullable().default(null),
  specPath: z.string().nullable().default(null),
  planPath: z.string().nullable().default(null),
  researchPath: z.string().nullable().default(null),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type SliceProps = z.infer<typeof SlicePropsSchema>;
export type SliceDTO = SliceProps;
```

### Classification Logic

```typescript
// Pure function in slice.schemas.ts
export function classifyComplexity(criteria: ComplexityCriteria): ComplexityTier {
  // S-tier: no architecture impact AND clear requirements AND single domain
  if (
    criteria.architectureImpact === "none" &&
    criteria.requirementClarity === "clear" &&
    criteria.domainScope === "single"
  ) {
    return "S";
  }
  // F-full: any of: high architecture impact, unclear requirements, or multi-domain
  if (
    criteria.architectureImpact === "high" ||
    criteria.requirementClarity === "unclear" ||
    criteria.domainScope === "multi"
  ) {
    return "F-full";
  }
  // F-lite: everything else
  return "F-lite";
}
```

### SliceStatusVO

```typescript
// domain/slice-status.vo.ts
export class SliceStatusVO extends ValueObject<{ value: SliceStatus }> {
  private static readonly TRANSITIONS: ReadonlyMap<SliceStatus, ReadonlySet<SliceStatus>>;
  // discussing -> researching
  // researching -> planning
  // planning -> planning (self-transition), executing
  // executing -> verifying
  // verifying -> executing (back-edge), reviewing
  // reviewing -> executing (back-edge), completing
  // completing -> closed

  static create(status: SliceStatus): SliceStatusVO;

  get value(): SliceStatus;

  canTransitionTo(target: SliceStatus): boolean;

  transitionTo(target: SliceStatus): Result<SliceStatusVO, InvalidTransitionError>;
  // Returns ok(new SliceStatusVO) on valid transition
  // Returns err(InvalidTransitionError) on invalid transition
  // Self-transition (planning -> planning) returns ok(new instance)
}
```

10 valid transitions total. `transitionTo` always returns a new `SliceStatusVO` instance (immutable VO pattern).

### Aggregate Root

```typescript
// domain/slice.aggregate.ts
export class Slice extends AggregateRoot<SliceProps> {
  private constructor(props: SliceProps) {
    super(props, SlicePropsSchema);
  }

  get id(): string;
  get milestoneId(): string;
  get label(): string;
  get title(): string;
  get description(): string;
  get status(): SliceStatus;
  get complexity(): ComplexityTier | null;
  get specPath(): string | null;
  get planPath(): string | null;
  get researchPath(): string | null;
  get createdAt(): Date;
  get updatedAt(): Date;

  static createNew(params: {
    id: Id; milestoneId: Id; label: string;
    title: string; description?: string; now: Date;
  }): Slice;
  // Sets status to "discussing", emits SliceCreatedEvent

  transitionTo(target: SliceStatus, now: Date): Result<void, InvalidTransitionError>;
  // Delegates to SliceStatusVO.transitionTo()
  // Updates status and updatedAt on success
  // Emits SliceStatusChangedEvent on success (except self-transitions: planning->planning updates updatedAt but does NOT emit event)

  classify(criteria: ComplexityCriteria, now: Date): void;
  // Calls classifyComplexity(), stores result, updates updatedAt

  static reconstitute(props: SliceProps): Slice;
}
```

### Domain Events

```typescript
// domain/slice-created.event.ts
export class SliceCreatedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.SLICE_CREATED;
}

// domain/slice-status-changed.event.ts
export class SliceStatusChangedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.SLICE_STATUS_CHANGED;
}
```

### Domain Error

```typescript
// domain/slice-not-found.error.ts
export class SliceNotFoundError extends BaseDomainError {
  readonly code = "SLICE.NOT_FOUND";

  constructor(identifier: string) {
    super(`Slice not found: ${identifier}`, { identifier });
  }
}
```

Slice-local error (not kernel). Other hexagons can define their own `*NotFoundError` if needed.

### Repository Port

```typescript
// domain/slice-repository.port.ts
export abstract class SliceRepositoryPort {
  abstract save(slice: Slice): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Slice | null, PersistenceError>>;
  abstract findByLabel(label: string): Promise<Result<Slice | null, PersistenceError>>;
  abstract findByMilestoneId(milestoneId: Id): Promise<Result<Slice[], PersistenceError>>;
}
```

Label uniqueness: `save()` returns `err(PersistenceError)` if a different slice with the same label exists.

### InMemorySliceRepository

```typescript
// infrastructure/in-memory-slice.repository.ts
export class InMemorySliceRepository extends SliceRepositoryPort {
  private store = new Map<string, SliceProps>();

  seed(slice: Slice): void;
  reset(): void;
}
```

### SqliteSliceRepository (Stub)

```typescript
// infrastructure/sqlite-slice.repository.ts
export class SqliteSliceRepository extends SliceRepositoryPort {
  // All methods throw 'Not implemented'
}
```

### Builder

```typescript
// domain/slice.builder.ts
export class SliceBuilder {
  withId(id: string): this;
  withMilestoneId(milestoneId: string): this;
  withLabel(label: string): this;
  withTitle(title: string): this;
  withDescription(description: string): this;
  withStatus(status: SliceStatus): this;
  withComplexity(tier: ComplexityTier): this;
  withSpecPath(path: string): this;
  withPlanPath(path: string): this;
  withResearchPath(path: string): this;
  build(): Slice;         // uses createNew() — always status "discussing"
  buildProps(): SliceProps; // raw props for reconstitution tests
}
```

### Barrel Export

```typescript
// index.ts
export type {
  SliceDTO,
  SliceStatus,
  ComplexityTier,
  ComplexityCriteria,
  ArchitectureImpact,
  RequirementClarity,
  DomainScope,
} from "./domain/slice.schemas";
export {
  SlicePropsSchema,
  SliceStatusSchema,
  SliceLabelSchema,
  ComplexityTierSchema,
  ComplexityCriteriaSchema,
  classifyComplexity,
} from "./domain/slice.schemas";
export { SliceRepositoryPort } from "./domain/slice-repository.port";
export { SliceCreatedEvent } from "./domain/slice-created.event";
export { SliceStatusChangedEvent } from "./domain/slice-status-changed.event";
export { SliceNotFoundError } from "./domain/slice-not-found.error";
// Slice aggregate and SliceStatusVO are NOT exported (internal to hexagon)
```

### Contract Tests

- save + findById roundtrip
- save + findByLabel roundtrip
- findByMilestoneId returns matching slices
- findByMilestoneId returns empty array when none match
- findById returns null for unknown id
- findByLabel returns null for unknown label
- label uniqueness: save rejects when a different slice with the same label exists
- save allows updating an existing slice (same id, same label)

## Acceptance Criteria

- [ ] AC1: `Slice.createNew()` creates a valid slice with status `discussing` and emits `SliceCreatedEvent`
- [ ] AC2: `SliceStatusVO` enforces all 10 valid transitions (7 forward + 3 back-edges)
- [ ] AC3: `SliceStatusVO` rejects invalid transitions with `InvalidTransitionError`
- [ ] AC4: Self-transition `planning->planning` returns ok, updates `updatedAt`, does NOT emit `SliceStatusChangedEvent`
- [ ] AC5: `Slice.transitionTo()` emits `SliceStatusChangedEvent` on non-self transitions
- [ ] AC6: `Slice.classify()` accepts `ComplexityCriteria` and stores computed tier
- [ ] AC7: Classification logic: S = no arch impact + clear reqs + single domain; F-full = high arch OR unclear reqs OR multi-domain; F-lite = everything else
- [ ] AC8: `Slice.reconstitute()` hydrates from props without emitting events
- [ ] AC9: Label validation enforces `M{nn}-S{nn}` format via Zod regex
- [ ] AC10: Label uniqueness enforced in repository: save rejects duplicate labels on different slices
- [ ] AC11: InMemorySliceRepository passes all contract tests
- [ ] AC12: InMemorySliceRepository has `seed()` and `reset()` test helpers
- [ ] AC13: SqliteSliceRepository stub exists with correct interface
- [ ] AC14: SliceBuilder produces valid Slices with Faker defaults
- [ ] AC15: `SliceNotFoundError` has code `SLICE.NOT_FOUND`
- [ ] AC16: Barrel exports only ports, events, schemas, DTOs, and errors (not the aggregate or VO)
- [ ] AC17: All tests pass: VO, aggregate, builder, contract suite
- [ ] AC18: `biome check` passes on all new files

## Non-Goals

- Working SQLite adapter (stubbed only)
- Application-layer use cases
- Cross-hexagon wiring (Slice <-> Milestone referential integrity)
- Status transition side effects (auto-creating spec/plan files)
- Event publishing to EventBus (events collected, not dispatched)
- `SliceStatusVO` exported from barrel (internal to hexagon)

## Dependencies

- kernel/ base classes (AggregateRoot, ValueObject, DomainEvent, Result, schemas, errors, event names)
- S05/S06 patterns (hexagon structure, contract tests, barrel exports)
- `InvalidTransitionError` from kernel (added in S06)

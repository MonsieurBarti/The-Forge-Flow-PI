# M01-S07: Slice Hexagon — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Build the Slice hexagon with an 8-state state machine (SliceStatusVO), complexity classification, and the established hexagon pattern from S05/S06.
**Architecture:** Flat hexagon with `domain/` and `infrastructure/` subdirectories. Barrel export at root. Contract test pattern for adapters.
**Tech Stack:** TypeScript, Zod v4, Vitest, @faker-js/faker

## File Structure

```
src/hexagons/slice/
  domain/
    slice.schemas.ts                — Zod schemas, types, classifyComplexity()
    slice-status.vo.ts              — SliceStatusVO value object with state machine
    slice-status.vo.spec.ts         — VO transition tests
    slice-created.event.ts          — Domain event
    slice-status-changed.event.ts   — Domain event
    slice-not-found.error.ts        — Slice-local domain error
    slice.aggregate.ts              — Aggregate root
    slice.aggregate.spec.ts         — Aggregate tests
    slice-repository.port.ts        — Abstract repository
    slice.builder.ts                — Faker test builder
  infrastructure/
    in-memory-slice.repository.ts         — In-memory adapter
    sqlite-slice.repository.ts            — SQLite stub
    slice-repository.contract.spec.ts     — Contract tests
  index.ts                          — Barrel export
```

---

## Prerequisites

- Kernel base classes available: AggregateRoot, ValueObject, DomainEvent, Result, schemas, errors, EVENT_NAMES
- `InvalidTransitionError` in kernel (added in S06)
- S05/S06 hexagon patterns established

---

## Wave 0 (parallel — no deps)

### T01: Create SlicePropsSchema, types, and classifyComplexity
**Files:** Create `src/hexagons/slice/domain/slice.schemas.ts`
**Traces to:** AC7, AC9
**Code:**
```typescript
import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

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

export function classifyComplexity(criteria: ComplexityCriteria): ComplexityTier {
  if (
    criteria.architectureImpact === "none" &&
    criteria.requirementClarity === "clear" &&
    criteria.domainScope === "single"
  ) {
    return "S";
  }
  if (
    criteria.architectureImpact === "high" ||
    criteria.requirementClarity === "unclear" ||
    criteria.domainScope === "multi"
  ) {
    return "F-full";
  }
  return "F-lite";
}

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
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S07/T01): add SlicePropsSchema, complexity types, and classifyComplexity`

### T02: Create SliceCreatedEvent and SliceStatusChangedEvent
**Files:** Create `src/hexagons/slice/domain/slice-created.event.ts`, `src/hexagons/slice/domain/slice-status-changed.event.ts`
**Traces to:** AC1, AC5
**Code:**
```typescript
// domain/slice-created.event.ts
import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class SliceCreatedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.SLICE_CREATED;
}
```
```typescript
// domain/slice-status-changed.event.ts
import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class SliceStatusChangedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.SLICE_STATUS_CHANGED;
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S07/T02): add SliceCreatedEvent and SliceStatusChangedEvent`

### T03: Create SliceNotFoundError
**Files:** Create `src/hexagons/slice/domain/slice-not-found.error.ts`
**Traces to:** AC15
**Code:**
```typescript
import { BaseDomainError } from "@kernel";

export class SliceNotFoundError extends BaseDomainError {
  readonly code = "SLICE.NOT_FOUND";

  constructor(identifier: string) {
    super(`Slice not found: ${identifier}`, { identifier });
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S07/T03): add SliceNotFoundError`

---

## Wave 1 (depends on T01)

### T04: Write failing tests for SliceStatusVO
**Files:** Create `src/hexagons/slice/domain/slice-status.vo.spec.ts`
**Traces to:** AC2, AC3, AC17
**Code:**
```typescript
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@kernel";
import { SliceStatusVO } from "./slice-status.vo";

describe("SliceStatusVO", () => {
  describe("valid transitions", () => {
    const validTransitions: [string, string][] = [
      ["discussing", "researching"],
      ["researching", "planning"],
      ["planning", "planning"],
      ["planning", "executing"],
      ["executing", "verifying"],
      ["verifying", "executing"],
      ["verifying", "reviewing"],
      ["reviewing", "executing"],
      ["reviewing", "completing"],
      ["completing", "closed"],
    ];

    for (const [from, to] of validTransitions) {
      it(`allows ${from} -> ${to}`, () => {
        const vo = SliceStatusVO.create(from as any);
        const result = vo.transitionTo(to as any);

        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data.value).toBe(to);
        }
      });
    }
  });

  describe("invalid transitions", () => {
    const invalidTransitions: [string, string][] = [
      ["discussing", "closed"],
      ["discussing", "planning"],
      ["researching", "executing"],
      ["executing", "planning"],
      ["closed", "discussing"],
      ["closed", "closed"],
      ["completing", "reviewing"],
      ["verifying", "planning"],
    ];

    for (const [from, to] of invalidTransitions) {
      it(`rejects ${from} -> ${to}`, () => {
        const vo = SliceStatusVO.create(from as any);
        const result = vo.transitionTo(to as any);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe("DOMAIN.INVALID_TRANSITION");
        }
      });
    }
  });

  describe("canTransitionTo", () => {
    it("returns true for valid transition", () => {
      const vo = SliceStatusVO.create("discussing");
      expect(vo.canTransitionTo("researching")).toBe(true);
    });

    it("returns false for invalid transition", () => {
      const vo = SliceStatusVO.create("discussing");
      expect(vo.canTransitionTo("closed")).toBe(false);
    });
  });

  describe("immutability", () => {
    it("transitionTo returns a new instance", () => {
      const vo = SliceStatusVO.create("discussing");
      const result = vo.transitionTo("researching");

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBe(vo);
        expect(vo.value).toBe("discussing");
      }
    });
  });

  describe("equality", () => {
    it("two VOs with same status are equal", () => {
      const a = SliceStatusVO.create("planning");
      const b = SliceStatusVO.create("planning");
      expect(a.equals(b)).toBe(true);
    });

    it("two VOs with different status are not equal", () => {
      const a = SliceStatusVO.create("planning");
      const b = SliceStatusVO.create("executing");
      expect(a.equals(b)).toBe(false);
    });
  });
});
```
**Run:** `npx vitest run src/hexagons/slice/domain/slice-status.vo.spec.ts`
**Expect:** FAIL — `Cannot find module './slice-status.vo'`

### T05: Implement SliceStatusVO
**Files:** Create `src/hexagons/slice/domain/slice-status.vo.ts`
**Traces to:** AC2, AC3, AC17
**Code:**
```typescript
import {
  InvalidTransitionError,
  ValueObject,
  type Result,
  err,
  ok,
} from "@kernel";
import { z } from "zod";
import { type SliceStatus, SliceStatusSchema } from "./slice.schemas";

const SliceStatusVOPropsSchema = z.object({ value: SliceStatusSchema });
type SliceStatusVOProps = z.infer<typeof SliceStatusVOPropsSchema>;

export class SliceStatusVO extends ValueObject<SliceStatusVOProps> {
  private static readonly TRANSITIONS: ReadonlyMap<
    SliceStatus,
    ReadonlySet<SliceStatus>
  > = new Map<SliceStatus, ReadonlySet<SliceStatus>>([
    ["discussing", new Set(["researching"])],
    ["researching", new Set(["planning"])],
    ["planning", new Set(["planning", "executing"])],
    ["executing", new Set(["verifying"])],
    ["verifying", new Set(["executing", "reviewing"])],
    ["reviewing", new Set(["executing", "completing"])],
    ["completing", new Set(["closed"])],
  ]);

  private constructor(props: SliceStatusVOProps) {
    super(props, SliceStatusVOPropsSchema);
  }

  static create(status: SliceStatus): SliceStatusVO {
    return new SliceStatusVO({ value: status });
  }

  get value(): SliceStatus {
    return this.props.value;
  }

  canTransitionTo(target: SliceStatus): boolean {
    const allowed = SliceStatusVO.TRANSITIONS.get(this.props.value);
    return allowed?.has(target) ?? false;
  }

  transitionTo(target: SliceStatus): Result<SliceStatusVO, InvalidTransitionError> {
    if (!this.canTransitionTo(target)) {
      return err(
        new InvalidTransitionError(this.props.value, target, "Slice"),
      );
    }
    return ok(SliceStatusVO.create(target));
  }
}
```
**Run:** `npx vitest run src/hexagons/slice/domain/slice-status.vo.spec.ts`
**Expect:** PASS — all ~22 tests passing
**Commit:** `feat(S07/T05): add SliceStatusVO with state machine`

---

## Wave 2 (depends on T01, T02, T03, T05)

### T06: Write failing tests for Slice aggregate
**Files:** Create `src/hexagons/slice/domain/slice.aggregate.spec.ts`
**Traces to:** AC1, AC4, AC5, AC6, AC8, AC17
**Code:**
```typescript
import { describe, expect, it } from "vitest";
import { EVENT_NAMES, isErr, isOk } from "@kernel";
import { Slice } from "./slice.aggregate";

describe("Slice", () => {
  const id = crypto.randomUUID();
  const milestoneId = crypto.randomUUID();
  const now = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-06-01T00:00:00Z");

  describe("createNew", () => {
    it("creates a valid slice with status discussing", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });

      expect(s.id).toBe(id);
      expect(s.milestoneId).toBe(milestoneId);
      expect(s.label).toBe("M01-S01");
      expect(s.title).toBe("Schemas");
      expect(s.description).toBe("");
      expect(s.status).toBe("discussing");
      expect(s.complexity).toBeNull();
      expect(s.specPath).toBeNull();
      expect(s.planPath).toBeNull();
      expect(s.researchPath).toBeNull();
      expect(s.createdAt).toEqual(now);
      expect(s.updatedAt).toEqual(now);
    });

    it("accepts optional description", () => {
      const s = Slice.createNew({
        id, milestoneId, label: "M01-S01", title: "Schemas", description: "Build schemas", now,
      });
      expect(s.description).toBe("Build schemas");
    });

    it("emits SliceCreatedEvent", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      const events = s.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.SLICE_CREATED);
      expect(events[0].aggregateId).toBe(id);
    });

    it("throws on invalid label format", () => {
      expect(() =>
        Slice.createNew({ id, milestoneId, label: "bad", title: "Schemas", now }),
      ).toThrow();
    });

    it("throws on empty title", () => {
      expect(() =>
        Slice.createNew({ id, milestoneId, label: "M01-S01", title: "", now }),
      ).toThrow();
    });

    it("throws on invalid id", () => {
      expect(() =>
        Slice.createNew({ id: "not-a-uuid", milestoneId, label: "M01-S01", title: "Schemas", now }),
      ).toThrow();
    });
  });

  describe("transitionTo", () => {
    it("transitions discussing -> researching", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      const result = s.transitionTo("researching", later);

      expect(isOk(result)).toBe(true);
      expect(s.status).toBe("researching");
      expect(s.updatedAt).toEqual(later);
    });

    it("emits SliceStatusChangedEvent on non-self transition", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.pullEvents(); // drain creation event
      s.transitionTo("researching", later);
      const events = s.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.SLICE_STATUS_CHANGED);
    });

    it("self-transition planning -> planning updates updatedAt but does NOT emit event", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.transitionTo("researching", now);
      s.transitionTo("planning", now);
      s.pullEvents(); // drain all prior events

      const result = s.transitionTo("planning", later);

      expect(isOk(result)).toBe(true);
      expect(s.status).toBe("planning");
      expect(s.updatedAt).toEqual(later);
      expect(s.pullEvents()).toEqual([]);
    });

    it("rejects invalid transition", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      const result = s.transitionTo("closed", later);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("DOMAIN.INVALID_TRANSITION");
      }
    });

    it("does not update status on invalid transition", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.transitionTo("closed", later);

      expect(s.status).toBe("discussing");
      expect(s.updatedAt).toEqual(now);
    });
  });

  describe("classify", () => {
    it("classifies as S-tier", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.classify({ architectureImpact: "none", requirementClarity: "clear", domainScope: "single" }, later);

      expect(s.complexity).toBe("S");
      expect(s.updatedAt).toEqual(later);
    });

    it("classifies as F-full", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.classify({ architectureImpact: "high", requirementClarity: "clear", domainScope: "single" }, later);

      expect(s.complexity).toBe("F-full");
    });

    it("classifies as F-lite", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.classify({ architectureImpact: "low", requirementClarity: "clear", domainScope: "single" }, later);

      expect(s.complexity).toBe("F-lite");
    });
  });

  describe("reconstitute", () => {
    it("hydrates from props without emitting events", () => {
      const props = {
        id, milestoneId, label: "M01-S01", title: "Schemas", description: "",
        status: "discussing" as const, complexity: null, specPath: null,
        planPath: null, researchPath: null, createdAt: now, updatedAt: now,
      };
      const s = Slice.reconstitute(props);

      expect(s.id).toBe(id);
      expect(s.label).toBe("M01-S01");
      expect(s.pullEvents()).toEqual([]);
    });

    it("throws on invalid props", () => {
      expect(() =>
        Slice.reconstitute({
          id: "not-a-uuid", milestoneId, label: "M01-S01", title: "Schemas",
          description: "", status: "discussing" as const, complexity: null,
          specPath: null, planPath: null, researchPath: null,
          createdAt: now, updatedAt: now,
        }),
      ).toThrow();
    });
  });

  describe("toJSON", () => {
    it("returns a copy of props", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      const json = s.toJSON();

      expect(json).toEqual({
        id, milestoneId, label: "M01-S01", title: "Schemas", description: "",
        status: "discussing", complexity: null, specPath: null,
        planPath: null, researchPath: null, createdAt: now, updatedAt: now,
      });
    });
  });
});
```
**Run:** `npx vitest run src/hexagons/slice/domain/slice.aggregate.spec.ts`
**Expect:** FAIL — `Cannot find module './slice.aggregate'`

### T07: Implement Slice aggregate
**Files:** Create `src/hexagons/slice/domain/slice.aggregate.ts`
**Traces to:** AC1, AC4, AC5, AC6, AC8, AC17
**Code:**
```typescript
import {
  AggregateRoot,
  type Id,
  type InvalidTransitionError,
  type Result,
} from "@kernel";
import { SliceCreatedEvent } from "./slice-created.event";
import { SliceStatusChangedEvent } from "./slice-status-changed.event";
import { SliceStatusVO } from "./slice-status.vo";
import {
  type ComplexityCriteria,
  type ComplexityTier,
  type SliceProps,
  SlicePropsSchema,
  type SliceStatus,
  classifyComplexity,
} from "./slice.schemas";

export class Slice extends AggregateRoot<SliceProps> {
  private constructor(props: SliceProps) {
    super(props, SlicePropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get milestoneId(): string {
    return this.props.milestoneId;
  }

  get label(): string {
    return this.props.label;
  }

  get title(): string {
    return this.props.title;
  }

  get description(): string {
    return this.props.description;
  }

  get status(): SliceStatus {
    return this.props.status;
  }

  get complexity(): ComplexityTier | null {
    return this.props.complexity;
  }

  get specPath(): string | null {
    return this.props.specPath;
  }

  get planPath(): string | null {
    return this.props.planPath;
  }

  get researchPath(): string | null {
    return this.props.researchPath;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  static createNew(params: {
    id: Id;
    milestoneId: Id;
    label: string;
    title: string;
    description?: string;
    now: Date;
  }): Slice {
    const slice = new Slice({
      id: params.id,
      milestoneId: params.milestoneId,
      label: params.label,
      title: params.title,
      description: params.description ?? "",
      status: "discussing",
      complexity: null,
      specPath: null,
      planPath: null,
      researchPath: null,
      createdAt: params.now,
      updatedAt: params.now,
    });
    slice.addEvent(
      new SliceCreatedEvent({
        id: crypto.randomUUID(),
        aggregateId: params.id,
        occurredAt: params.now,
      }),
    );
    return slice;
  }

  transitionTo(
    target: SliceStatus,
    now: Date,
  ): Result<void, InvalidTransitionError> {
    const currentVO = SliceStatusVO.create(this.props.status);
    const isSelfTransition = this.props.status === target;
    const result = currentVO.transitionTo(target);

    if (!result.ok) {
      return result;
    }

    this.props.status = result.data.value;
    this.props.updatedAt = now;

    if (!isSelfTransition) {
      this.addEvent(
        new SliceStatusChangedEvent({
          id: crypto.randomUUID(),
          aggregateId: this.props.id,
          occurredAt: now,
        }),
      );
    }

    return { ok: true, data: undefined };
  }

  classify(criteria: ComplexityCriteria, now: Date): void {
    this.props.complexity = classifyComplexity(criteria);
    this.props.updatedAt = now;
  }

  static reconstitute(props: SliceProps): Slice {
    return new Slice(props);
  }
}
```
**Run:** `npx vitest run src/hexagons/slice/domain/slice.aggregate.spec.ts`
**Expect:** PASS — all ~16 tests passing
**Commit:** `feat(S07/T07): add Slice aggregate with tests`

---

## Wave 3 (depends on T07 — parallel)

### T08: Create SliceRepositoryPort
**Files:** Create `src/hexagons/slice/domain/slice-repository.port.ts`
**Traces to:** AC10, AC11
**Code:**
```typescript
import type { Id, PersistenceError, Result } from "@kernel";
import type { Slice } from "./slice.aggregate";

export abstract class SliceRepositoryPort {
  abstract save(slice: Slice): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Slice | null, PersistenceError>>;
  abstract findByLabel(label: string): Promise<Result<Slice | null, PersistenceError>>;
  abstract findByMilestoneId(milestoneId: Id): Promise<Result<Slice[], PersistenceError>>;
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S07/T08): add SliceRepositoryPort`

### T09: Create SliceBuilder
**Files:** Create `src/hexagons/slice/domain/slice.builder.ts`
**Traces to:** AC14
**Code:**
```typescript
import { faker } from "@faker-js/faker";
import { Slice } from "./slice.aggregate";
import type { ComplexityTier, SliceProps, SliceStatus } from "./slice.schemas";

export class SliceBuilder {
  private _id: string = faker.string.uuid();
  private _milestoneId: string = faker.string.uuid();
  private _label = "M01-S01";
  private _title: string = faker.lorem.words(3);
  private _description: string = faker.lorem.sentence();
  private _status: SliceStatus = "discussing";
  private _complexity: ComplexityTier | null = null;
  private _specPath: string | null = null;
  private _planPath: string | null = null;
  private _researchPath: string | null = null;
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withMilestoneId(milestoneId: string): this {
    this._milestoneId = milestoneId;
    return this;
  }

  withLabel(label: string): this {
    this._label = label;
    return this;
  }

  withTitle(title: string): this {
    this._title = title;
    return this;
  }

  withDescription(description: string): this {
    this._description = description;
    return this;
  }

  withStatus(status: SliceStatus): this {
    this._status = status;
    return this;
  }

  withComplexity(tier: ComplexityTier): this {
    this._complexity = tier;
    return this;
  }

  withSpecPath(path: string): this {
    this._specPath = path;
    return this;
  }

  withPlanPath(path: string): this {
    this._planPath = path;
    return this;
  }

  withResearchPath(path: string): this {
    this._researchPath = path;
    return this;
  }

  build(): Slice {
    return Slice.createNew({
      id: this._id,
      milestoneId: this._milestoneId,
      label: this._label,
      title: this._title,
      description: this._description,
      now: this._now,
    });
  }

  buildProps(): SliceProps {
    return {
      id: this._id,
      milestoneId: this._milestoneId,
      label: this._label,
      title: this._title,
      description: this._description,
      status: this._status,
      complexity: this._complexity,
      specPath: this._specPath,
      planPath: this._planPath,
      researchPath: this._researchPath,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S07/T09): add SliceBuilder with Faker defaults`

---

## Wave 4 (depends on T08, T09 — parallel)

### T10: Implement InMemorySliceRepository
**Files:** Create `src/hexagons/slice/infrastructure/in-memory-slice.repository.ts`
**Traces to:** AC10, AC11, AC12
**Code:**
```typescript
import { type Id, PersistenceError, type Result, err, ok } from "@kernel";
import { Slice } from "../domain/slice.aggregate";
import { SliceRepositoryPort } from "../domain/slice-repository.port";
import type { SliceProps } from "../domain/slice.schemas";

export class InMemorySliceRepository extends SliceRepositoryPort {
  private store = new Map<string, SliceProps>();

  async save(slice: Slice): Promise<Result<void, PersistenceError>> {
    const props = slice.toJSON();
    for (const [existingId, existingProps] of this.store) {
      if (existingId !== props.id && existingProps.label === props.label) {
        return err(
          new PersistenceError(
            `Label uniqueness violated: slice '${props.label}' already exists`,
          ),
        );
      }
    }
    this.store.set(props.id, props);
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Slice | null, PersistenceError>> {
    const props = this.store.get(id);
    if (!props) return ok(null);
    return ok(Slice.reconstitute(props));
  }

  async findByLabel(label: string): Promise<Result<Slice | null, PersistenceError>> {
    for (const props of this.store.values()) {
      if (props.label === label) {
        return ok(Slice.reconstitute(props));
      }
    }
    return ok(null);
  }

  async findByMilestoneId(milestoneId: Id): Promise<Result<Slice[], PersistenceError>> {
    const results: Slice[] = [];
    for (const props of this.store.values()) {
      if (props.milestoneId === milestoneId) {
        results.push(Slice.reconstitute(props));
      }
    }
    return ok(results);
  }

  seed(slice: Slice): void {
    this.store.set(slice.id, slice.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S07/T10): add InMemorySliceRepository`

### T11: Create SqliteSliceRepository stub
**Files:** Create `src/hexagons/slice/infrastructure/sqlite-slice.repository.ts`
**Traces to:** AC13
**Code:**
```typescript
import type { Id, PersistenceError, Result } from "@kernel";
import type { Slice } from "../domain/slice.aggregate";
import { SliceRepositoryPort } from "../domain/slice-repository.port";

export class SqliteSliceRepository extends SliceRepositoryPort {
  save(_slice: Slice): Promise<Result<void, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findById(_id: Id): Promise<Result<Slice | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findByLabel(_label: string): Promise<Result<Slice | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findByMilestoneId(_milestoneId: Id): Promise<Result<Slice[], PersistenceError>> {
    throw new Error("Not implemented");
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S07/T11): add SqliteSliceRepository stub`

---

## Wave 5 (depends on T10)

### T12: Write and run contract test suite
**Files:** Create `src/hexagons/slice/infrastructure/slice-repository.contract.spec.ts`
**Traces to:** AC10, AC11, AC12, AC17
**Code:**
```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { isErr, isOk } from "@kernel";
import { SliceBuilder } from "../domain/slice.builder";
import type { SliceRepositoryPort } from "../domain/slice-repository.port";
import { InMemorySliceRepository } from "./in-memory-slice.repository";

function runContractTests(
  name: string,
  factory: () => SliceRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: SliceRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findById roundtrip", async () => {
      const slice = new SliceBuilder().build();
      const saveResult = await repo.save(slice);
      expect(isOk(saveResult)).toBe(true);

      const findResult = await repo.findById(slice.id);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data!.id).toBe(slice.id);
        expect(findResult.data!.label).toBe(slice.label);
        expect(findResult.data!.title).toBe(slice.title);
      }
    });

    it("save + findByLabel roundtrip", async () => {
      const slice = new SliceBuilder().withLabel("M01-S05").build();
      await repo.save(slice);

      const result = await repo.findByLabel("M01-S05");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBeNull();
        expect(result.data!.id).toBe(slice.id);
      }
    });

    it("findByMilestoneId returns matching slices", async () => {
      const milestoneId = crypto.randomUUID();
      const s1 = new SliceBuilder().withMilestoneId(milestoneId).withLabel("M01-S01").build();
      const s2 = new SliceBuilder().withMilestoneId(milestoneId).withLabel("M01-S02").build();
      const s3 = new SliceBuilder().withLabel("M01-S03").build(); // different milestone
      await repo.save(s1);
      await repo.save(s2);
      await repo.save(s3);

      const result = await repo.findByMilestoneId(milestoneId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(2);
      }
    });

    it("findByMilestoneId returns empty array when none match", async () => {
      const result = await repo.findByMilestoneId(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([]);
      }
    });

    it("findById returns null for unknown id", async () => {
      const result = await repo.findById(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("findByLabel returns null for unknown label", async () => {
      const result = await repo.findByLabel("M99-S99");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("label uniqueness: rejects duplicate label on different slice", async () => {
      const s1 = new SliceBuilder().withLabel("M01-S01").build();
      const s2 = new SliceBuilder().withLabel("M01-S01").build();
      await repo.save(s1);

      const result = await repo.save(s2);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("Label uniqueness");
      }
    });

    it("save allows updating an existing slice", async () => {
      const slice = new SliceBuilder().build();
      await repo.save(slice);

      slice.transitionTo("researching", new Date());
      const result = await repo.save(slice);
      expect(isOk(result)).toBe(true);
    });
  });
}

runContractTests(
  "InMemorySliceRepository",
  () => new InMemorySliceRepository(),
);
```
**Run:** `npx vitest run src/hexagons/slice/infrastructure/slice-repository.contract.spec.ts`
**Expect:** PASS — 8/8 tests passing
**Commit:** `test(S07/T12): add slice repository contract test suite`

---

## Wave 6 (depends on all)

### T13: Create barrel export and verify
**Files:** Create `src/hexagons/slice/index.ts`
**Traces to:** AC16, AC18
**Code:**
```typescript
export type {
  ArchitectureImpact,
  ComplexityCriteria,
  ComplexityTier,
  DomainScope,
  RequirementClarity,
  SliceDTO,
  SliceStatus,
} from "./domain/slice.schemas";
export {
  ComplexityCriteriaSchema,
  ComplexityTierSchema,
  SliceLabelSchema,
  SlicePropsSchema,
  SliceStatusSchema,
  classifyComplexity,
} from "./domain/slice.schemas";
export { SliceRepositoryPort } from "./domain/slice-repository.port";
export { SliceCreatedEvent } from "./domain/slice-created.event";
export { SliceStatusChangedEvent } from "./domain/slice-status-changed.event";
export { SliceNotFoundError } from "./domain/slice-not-found.error";
// Slice aggregate and SliceStatusVO are NOT exported (internal to hexagon)
```
**Run:** `npx biome check src/hexagons/slice/ && npx vitest run src/hexagons/slice/`
**Expect:** PASS — biome clean, all tests pass (VO + aggregate + contract)
**Commit:** `feat(S07/T13): add slice hexagon barrel export`

---

## AC Traceability

| AC | Tasks |
|---|---|
| AC1: createNew() creates slice with status discussing + emits event | T01, T02, T06, T07 |
| AC2: SliceStatusVO enforces all 10 valid transitions | T04, T05 |
| AC3: SliceStatusVO rejects invalid transitions | T04, T05 |
| AC4: Self-transition planning->planning: ok, updatedAt, no event | T06, T07 |
| AC5: transitionTo() emits SliceStatusChangedEvent on non-self transitions | T02, T06, T07 |
| AC6: classify() accepts ComplexityCriteria, stores tier | T01, T06, T07 |
| AC7: Classification logic: S/F-lite/F-full axes | T01, T06 |
| AC8: reconstitute() hydrates without events | T06, T07 |
| AC9: Label validation enforces M{nn}-S{nn} format | T01, T06 |
| AC10: Label uniqueness in repository | T08, T10, T12 |
| AC11: InMemorySliceRepository passes contract tests | T10, T12 |
| AC12: InMemory has seed() and reset() helpers | T10, T12 |
| AC13: SqliteSliceRepository stub exists | T11 |
| AC14: SliceBuilder with Faker defaults | T09 |
| AC15: SliceNotFoundError has code SLICE.NOT_FOUND | T03 |
| AC16: Barrel exports only ports, events, schemas, DTOs, errors | T13 |
| AC17: All tests pass | T04, T05, T06, T07, T12 |
| AC18: biome check passes | T13 |

## Wave Summary

| Wave | Tasks | Parallelizable |
|------|-------|---------------|
| 0 | T01, T02, T03 | yes (3 parallel) |
| 1 | T04, T05 | no (sequential TDD) |
| 2 | T06, T07 | no (sequential TDD) |
| 3 | T08, T09 | yes (2 parallel) |
| 4 | T10, T11 | yes (2 parallel) |
| 5 | T12 | no |
| 6 | T13 | no |

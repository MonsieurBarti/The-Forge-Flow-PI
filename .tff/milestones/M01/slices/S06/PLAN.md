# M01-S06: Milestone Hexagon — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Build the Milestone hexagon following the pattern established by Project (S05), introducing status transitions and label-based lookups.
**Architecture:** Flat hexagon with `domain/` and `infrastructure/` subdirectories. Barrel export at root. Contract test pattern for adapters.
**Tech Stack:** TypeScript, Zod v4, Vitest, @faker-js/faker

## File Structure

```
src/kernel/errors/
  invalid-transition.error.ts   — NEW: shared error for status transitions

src/hexagons/milestone/
  domain/
    milestone.schemas.ts              — Zod schemas + types
    milestone-created.event.ts        — Domain event
    milestone-closed.event.ts         — Domain event
    milestone.aggregate.ts            — Aggregate root
    milestone.aggregate.spec.ts       — Aggregate tests
    milestone-repository.port.ts      — Abstract repository
    milestone.builder.ts              — Faker test builder
  infrastructure/
    in-memory-milestone.repository.ts       — In-memory adapter
    sqlite-milestone.repository.ts          — SQLite stub
    milestone-repository.contract.spec.ts   — Contract tests
  index.ts                            — Barrel export
```

---

## Prerequisites

- Kernel base classes available: AggregateRoot, DomainEvent, Result, schemas, errors, EVENT_NAMES
- Project hexagon (S05) completed — pattern reference

---

## Wave 0 (parallel — no deps)

### T01: Add InvalidTransitionError to kernel
**Files:** Create `src/kernel/errors/invalid-transition.error.ts`, edit `src/kernel/errors/index.ts`, edit `src/kernel/index.ts`
**Traces to:** AC12
**Code:**
```typescript
// src/kernel/errors/invalid-transition.error.ts
import { BaseDomainError } from "./base-domain.error";

export class InvalidTransitionError extends BaseDomainError {
  readonly code = "DOMAIN.INVALID_TRANSITION";

  constructor(from: string, to: string, entity: string) {
    super(`Invalid transition from '${from}' to '${to}' on ${entity}`, {
      from,
      to,
      entity,
    });
  }
}
```

Add to `src/kernel/errors/index.ts`:
```typescript
export { InvalidTransitionError } from "./invalid-transition.error";
```

Add to `src/kernel/index.ts` (in the errors import block):
```typescript
InvalidTransitionError,
```
**Run:** `npx tsc --noEmit && npx vitest run src/kernel/`
**Expect:** PASS — no type errors, existing kernel tests still pass
**Commit:** `feat(S06/T01): add InvalidTransitionError to kernel errors`

### T02: Create MilestonePropsSchema and types
**Files:** Create `src/hexagons/milestone/domain/milestone.schemas.ts`
**Traces to:** AC1, AC6
**Code:**
```typescript
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
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S06/T02): add MilestonePropsSchema and types`

### T03: Create MilestoneCreatedEvent and MilestoneClosedEvent
**Files:** Create `src/hexagons/milestone/domain/milestone-created.event.ts`, `src/hexagons/milestone/domain/milestone-closed.event.ts`
**Traces to:** AC1, AC3
**Code:**
```typescript
// domain/milestone-created.event.ts
import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class MilestoneCreatedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.MILESTONE_CREATED;
}
```
```typescript
// domain/milestone-closed.event.ts
import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class MilestoneClosedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.MILESTONE_CLOSED;
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S06/T03): add MilestoneCreatedEvent and MilestoneClosedEvent`

---

## Wave 1 (depends on T01, T02, T03)

### T04: Write failing tests for Milestone aggregate
**Files:** Create `src/hexagons/milestone/domain/milestone.aggregate.spec.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6, AC14
**Code:**
```typescript
import { describe, expect, it } from "vitest";
import { EVENT_NAMES, isErr, isOk } from "@kernel";
import { Milestone } from "./milestone.aggregate";

describe("Milestone", () => {
  const id = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const now = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-06-01T00:00:00Z");

  describe("createNew", () => {
    it("creates a valid milestone with status open", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });

      expect(m.id).toBe(id);
      expect(m.projectId).toBe(projectId);
      expect(m.label).toBe("M01");
      expect(m.title).toBe("Kernel");
      expect(m.description).toBe("");
      expect(m.status).toBe("open");
      expect(m.createdAt).toEqual(now);
      expect(m.updatedAt).toEqual(now);
    });

    it("accepts optional description", () => {
      const m = Milestone.createNew({
        id, projectId, label: "M01", title: "Kernel", description: "Build kernel", now,
      });
      expect(m.description).toBe("Build kernel");
    });

    it("emits MilestoneCreatedEvent", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      const events = m.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.MILESTONE_CREATED);
      expect(events[0].aggregateId).toBe(id);
    });

    it("derives branch from label", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      expect(m.branch).toBe("milestone/M01");
    });

    it("throws on invalid label format", () => {
      expect(() =>
        Milestone.createNew({ id, projectId, label: "bad", title: "Kernel", now }),
      ).toThrow();
    });

    it("throws on empty title", () => {
      expect(() =>
        Milestone.createNew({ id, projectId, label: "M01", title: "", now }),
      ).toThrow();
    });

    it("throws on invalid id", () => {
      expect(() =>
        Milestone.createNew({ id: "not-a-uuid", projectId, label: "M01", title: "Kernel", now }),
      ).toThrow();
    });
  });

  describe("activate", () => {
    it("transitions open -> in_progress", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      const result = m.activate(later);

      expect(isOk(result)).toBe(true);
      expect(m.status).toBe("in_progress");
      expect(m.updatedAt).toEqual(later);
    });

    it("rejects in_progress -> in_progress", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.activate(later);
      const result = m.activate(later);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("DOMAIN.INVALID_TRANSITION");
      }
    });

    it("rejects closed -> in_progress", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.activate(later);
      m.close(later);
      const result = m.activate(later);

      expect(isErr(result)).toBe(true);
    });

    it("does not emit events", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.pullEvents(); // drain creation event
      m.activate(later);

      expect(m.pullEvents()).toEqual([]);
    });
  });

  describe("close", () => {
    it("transitions in_progress -> closed", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.activate(later);
      const result = m.close(later);

      expect(isOk(result)).toBe(true);
      expect(m.status).toBe("closed");
    });

    it("emits MilestoneClosedEvent", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.activate(later);
      m.pullEvents(); // drain prior events
      m.close(later);
      const events = m.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.MILESTONE_CLOSED);
      expect(events[0].aggregateId).toBe(id);
    });

    it("rejects open -> closed", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      const result = m.close(later);

      expect(isErr(result)).toBe(true);
    });

    it("rejects closed -> closed", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.activate(later);
      m.close(later);
      const result = m.close(later);

      expect(isErr(result)).toBe(true);
    });
  });

  describe("reconstitute", () => {
    it("hydrates from props without emitting events", () => {
      const props = {
        id, projectId, label: "M01", title: "Kernel", description: "",
        status: "open" as const, createdAt: now, updatedAt: now,
      };
      const m = Milestone.reconstitute(props);

      expect(m.id).toBe(id);
      expect(m.label).toBe("M01");
      expect(m.pullEvents()).toEqual([]);
    });

    it("throws on invalid props", () => {
      expect(() =>
        Milestone.reconstitute({
          id: "not-a-uuid", projectId, label: "M01", title: "Kernel",
          description: "", status: "open" as const, createdAt: now, updatedAt: now,
        }),
      ).toThrow();
    });
  });

  describe("toJSON", () => {
    it("returns a copy of props", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      const json = m.toJSON();

      expect(json).toEqual({
        id, projectId, label: "M01", title: "Kernel", description: "",
        status: "open", createdAt: now, updatedAt: now,
      });
    });
  });
});
```
**Run:** `npx vitest run src/hexagons/milestone/domain/milestone.aggregate.spec.ts`
**Expect:** FAIL — `Cannot find module './milestone.aggregate'`

### T05: Implement Milestone aggregate
**Files:** Create `src/hexagons/milestone/domain/milestone.aggregate.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6, AC14
**Code:**
```typescript
import {
  AggregateRoot,
  type Id,
  InvalidTransitionError,
  err,
  ok,
  type Result,
} from "@kernel";
import { MilestoneClosedEvent } from "./milestone-closed.event";
import { MilestoneCreatedEvent } from "./milestone-created.event";
import {
  type MilestoneProps,
  MilestonePropsSchema,
  type MilestoneStatus,
} from "./milestone.schemas";

export class Milestone extends AggregateRoot<MilestoneProps> {
  private constructor(props: MilestoneProps) {
    super(props, MilestonePropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get projectId(): string {
    return this.props.projectId;
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

  get status(): MilestoneStatus {
    return this.props.status;
  }

  get branch(): string {
    return `milestone/${this.props.label}`;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  static createNew(params: {
    id: Id;
    projectId: Id;
    label: string;
    title: string;
    description?: string;
    now: Date;
  }): Milestone {
    const milestone = new Milestone({
      id: params.id,
      projectId: params.projectId,
      label: params.label,
      title: params.title,
      description: params.description ?? "",
      status: "open",
      createdAt: params.now,
      updatedAt: params.now,
    });
    milestone.addEvent(
      new MilestoneCreatedEvent({
        id: crypto.randomUUID(),
        aggregateId: params.id,
        occurredAt: params.now,
      }),
    );
    return milestone;
  }

  activate(now: Date): Result<void, InvalidTransitionError> {
    if (this.props.status !== "open") {
      return err(
        new InvalidTransitionError(this.props.status, "in_progress", "Milestone"),
      );
    }
    this.props.status = "in_progress";
    this.props.updatedAt = now;
    return ok(undefined);
  }

  close(now: Date): Result<void, InvalidTransitionError> {
    if (this.props.status !== "in_progress") {
      return err(
        new InvalidTransitionError(this.props.status, "closed", "Milestone"),
      );
    }
    this.props.status = "closed";
    this.props.updatedAt = now;
    this.addEvent(
      new MilestoneClosedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
      }),
    );
    return ok(undefined);
  }

  static reconstitute(props: MilestoneProps): Milestone {
    return new Milestone(props);
  }
}
```
**Run:** `npx vitest run src/hexagons/milestone/domain/milestone.aggregate.spec.ts`
**Expect:** PASS — all 16 tests passing
**Commit:** `feat(S06/T05): add Milestone aggregate with tests`

---

## Wave 2 (depends on T05 — parallel)

### T06: Create MilestoneRepositoryPort
**Files:** Create `src/hexagons/milestone/domain/milestone-repository.port.ts`
**Traces to:** AC7, AC8
**Code:**
```typescript
import type { Id, PersistenceError, Result } from "@kernel";
import type { Milestone } from "./milestone.aggregate";

export abstract class MilestoneRepositoryPort {
  abstract save(milestone: Milestone): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Milestone | null, PersistenceError>>;
  abstract findByLabel(label: string): Promise<Result<Milestone | null, PersistenceError>>;
  abstract findByProjectId(projectId: Id): Promise<Result<Milestone[], PersistenceError>>;
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S06/T06): add MilestoneRepositoryPort`

### T07: Create MilestoneBuilder
**Files:** Create `src/hexagons/milestone/domain/milestone.builder.ts`
**Traces to:** AC11
**Code:**
```typescript
import { faker } from "@faker-js/faker";
import { Milestone } from "./milestone.aggregate";
import type { MilestoneProps, MilestoneStatus } from "./milestone.schemas";

export class MilestoneBuilder {
  private _id: string = faker.string.uuid();
  private _projectId: string = faker.string.uuid();
  private _label = "M01";
  private _title: string = faker.lorem.words(3);
  private _description: string = faker.lorem.sentence();
  private _status: MilestoneStatus = "open";
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withProjectId(projectId: string): this {
    this._projectId = projectId;
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

  withStatus(status: MilestoneStatus): this {
    this._status = status;
    return this;
  }

  build(): Milestone {
    return Milestone.createNew({
      id: this._id,
      projectId: this._projectId,
      label: this._label,
      title: this._title,
      description: this._description,
      now: this._now,
    });
  }

  buildProps(): MilestoneProps {
    return {
      id: this._id,
      projectId: this._projectId,
      label: this._label,
      title: this._title,
      description: this._description,
      status: this._status,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S06/T07): add MilestoneBuilder with Faker defaults`

---

## Wave 3 (depends on T06, T07 — parallel)

### T08: Implement InMemoryMilestoneRepository
**Files:** Create `src/hexagons/milestone/infrastructure/in-memory-milestone.repository.ts`
**Traces to:** AC7, AC8, AC9
**Code:**
```typescript
import { type Id, PersistenceError, type Result, err, ok } from "@kernel";
import { Milestone } from "../domain/milestone.aggregate";
import { MilestoneRepositoryPort } from "../domain/milestone-repository.port";
import type { MilestoneProps } from "../domain/milestone.schemas";

export class InMemoryMilestoneRepository extends MilestoneRepositoryPort {
  private store = new Map<string, MilestoneProps>();

  async save(milestone: Milestone): Promise<Result<void, PersistenceError>> {
    const props = milestone.toJSON();
    for (const [existingId, existingProps] of this.store) {
      if (existingId !== props.id && existingProps.label === props.label) {
        return err(
          new PersistenceError(
            `Label uniqueness violated: milestone '${props.label}' already exists`,
          ),
        );
      }
    }
    this.store.set(props.id, props);
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Milestone | null, PersistenceError>> {
    const props = this.store.get(id);
    if (!props) return ok(null);
    return ok(Milestone.reconstitute(props));
  }

  async findByLabel(label: string): Promise<Result<Milestone | null, PersistenceError>> {
    for (const props of this.store.values()) {
      if (props.label === label) {
        return ok(Milestone.reconstitute(props));
      }
    }
    return ok(null);
  }

  async findByProjectId(projectId: Id): Promise<Result<Milestone[], PersistenceError>> {
    const results: Milestone[] = [];
    for (const props of this.store.values()) {
      if (props.projectId === projectId) {
        results.push(Milestone.reconstitute(props));
      }
    }
    return ok(results);
  }

  seed(milestone: Milestone): void {
    this.store.set(milestone.id, milestone.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S06/T08): add InMemoryMilestoneRepository`

### T09: Create SqliteMilestoneRepository stub
**Files:** Create `src/hexagons/milestone/infrastructure/sqlite-milestone.repository.ts`
**Traces to:** AC10
**Code:**
```typescript
import type { Id, PersistenceError, Result } from "@kernel";
import type { Milestone } from "../domain/milestone.aggregate";
import { MilestoneRepositoryPort } from "../domain/milestone-repository.port";

export class SqliteMilestoneRepository extends MilestoneRepositoryPort {
  save(_milestone: Milestone): Promise<Result<void, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findById(_id: Id): Promise<Result<Milestone | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findByLabel(_label: string): Promise<Result<Milestone | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findByProjectId(_projectId: Id): Promise<Result<Milestone[], PersistenceError>> {
    throw new Error("Not implemented");
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S06/T09): add SqliteMilestoneRepository stub`

---

## Wave 4 (depends on T08)

### T10: Write and run contract test suite
**Files:** Create `src/hexagons/milestone/infrastructure/milestone-repository.contract.spec.ts`
**Traces to:** AC7, AC8, AC9, AC14
**Code:**
```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { isErr, isOk } from "@kernel";
import { MilestoneBuilder } from "../domain/milestone.builder";
import type { MilestoneRepositoryPort } from "../domain/milestone-repository.port";
import { InMemoryMilestoneRepository } from "./in-memory-milestone.repository";

function runContractTests(
  name: string,
  factory: () => MilestoneRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: MilestoneRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findById roundtrip", async () => {
      const milestone = new MilestoneBuilder().build();
      const saveResult = await repo.save(milestone);
      expect(isOk(saveResult)).toBe(true);

      const findResult = await repo.findById(milestone.id);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data!.id).toBe(milestone.id);
        expect(findResult.data!.label).toBe(milestone.label);
        expect(findResult.data!.title).toBe(milestone.title);
      }
    });

    it("save + findByLabel roundtrip", async () => {
      const milestone = new MilestoneBuilder().withLabel("M05").build();
      await repo.save(milestone);

      const result = await repo.findByLabel("M05");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBeNull();
        expect(result.data!.id).toBe(milestone.id);
      }
    });

    it("findByProjectId returns matching milestones", async () => {
      const projectId = crypto.randomUUID();
      const m1 = new MilestoneBuilder().withProjectId(projectId).withLabel("M01").build();
      const m2 = new MilestoneBuilder().withProjectId(projectId).withLabel("M02").build();
      const m3 = new MilestoneBuilder().withLabel("M03").build(); // different project
      await repo.save(m1);
      await repo.save(m2);
      await repo.save(m3);

      const result = await repo.findByProjectId(projectId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(2);
      }
    });

    it("findByProjectId returns empty array when none match", async () => {
      const result = await repo.findByProjectId(crypto.randomUUID());
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
      const result = await repo.findByLabel("M99");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("label uniqueness: rejects duplicate label on different milestone", async () => {
      const m1 = new MilestoneBuilder().withLabel("M01").build();
      const m2 = new MilestoneBuilder().withLabel("M01").build();
      await repo.save(m1);

      const result = await repo.save(m2);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("Label uniqueness");
      }
    });

    it("save allows updating an existing milestone", async () => {
      const milestone = new MilestoneBuilder().build();
      await repo.save(milestone);

      milestone.activate(new Date());
      const result = await repo.save(milestone);
      expect(isOk(result)).toBe(true);
    });
  });
}

runContractTests(
  "InMemoryMilestoneRepository",
  () => new InMemoryMilestoneRepository(),
);
```
**Run:** `npx vitest run src/hexagons/milestone/infrastructure/milestone-repository.contract.spec.ts`
**Expect:** PASS — 8/8 tests passing
**Commit:** `test(S06/T10): add milestone repository contract test suite`

---

## Wave 5 (depends on all)

### T11: Create barrel export and verify
**Files:** Create `src/hexagons/milestone/index.ts`
**Traces to:** AC13, AC15
**Code:**
```typescript
export type { MilestoneDTO, MilestoneStatus } from "./domain/milestone.schemas";
export {
  MilestoneLabelSchema,
  MilestonePropsSchema,
  MilestoneStatusSchema,
} from "./domain/milestone.schemas";
export { MilestoneRepositoryPort } from "./domain/milestone-repository.port";
export { MilestoneCreatedEvent } from "./domain/milestone-created.event";
export { MilestoneClosedEvent } from "./domain/milestone-closed.event";
// Milestone aggregate is NOT exported (internal to hexagon)
```
**Run:** `npx biome check src/hexagons/milestone/ src/kernel/errors/ && npx vitest run src/hexagons/milestone/ src/kernel/`
**Expect:** PASS — biome clean, all tests pass (milestone + kernel)
**Commit:** `feat(S06/T11): add milestone hexagon barrel export`

---

## AC Traceability

| AC | Tasks |
|---|---|
| AC1: createNew() creates milestone with status open + emits event | T02, T03, T04, T05 |
| AC2: activate() transitions open -> in_progress, rejects other states | T01, T04, T05 |
| AC3: close() transitions in_progress -> closed + emits event, rejects other states | T01, T03, T04, T05 |
| AC4: branch returns `milestone/${label}` (derived) | T04, T05 |
| AC5: reconstitute() hydrates without events | T04, T05 |
| AC6: Label validation enforces M{nn} format | T02, T04, T05 |
| AC7: Label uniqueness in repository | T06, T08, T10 |
| AC8: InMemoryMilestoneRepository passes contract tests | T08, T10 |
| AC9: InMemory has seed() and reset() helpers | T08, T10 |
| AC10: SqliteMilestoneRepository stub exists | T09 |
| AC11: MilestoneBuilder with Faker defaults | T07 |
| AC12: InvalidTransitionError in kernel | T01 |
| AC13: Barrel exports only ports, events, schemas, DTOs | T11 |
| AC14: All tests pass | T04, T05, T10 |
| AC15: biome check passes | T11 |

## Wave Summary

| Wave | Tasks | Parallelizable |
|------|-------|---------------|
| 0 | T01, T02, T03 | yes (3 parallel) |
| 1 | T04, T05 | no (sequential TDD) |
| 2 | T06, T07 | yes (2 parallel) |
| 3 | T08, T09 | yes (2 parallel) |
| 4 | T10 | no |
| 5 | T11 | no |

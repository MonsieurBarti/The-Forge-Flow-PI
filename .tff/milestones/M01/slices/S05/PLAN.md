# M01-S05: Project Hexagon — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Build the first hexagon (Project) on top of the kernel, establishing the pattern for Milestone and Slice hexagons.
**Architecture:** Flat hexagon with `domain/` and `infrastructure/` subdirectories. Barrel export at root. Contract test pattern for adapters.
**Tech Stack:** TypeScript, Zod v4, Vitest, @faker-js/faker

## File Structure

```
src/hexagons/project/
  domain/
    project.schemas.ts          — Zod schemas + types
    project-initialized.event.ts — Domain event
    project.aggregate.ts         — Aggregate root
    project.aggregate.spec.ts    — Aggregate tests
    project-repository.port.ts   — Abstract repository
    project.builder.ts           — Faker test builder
  infrastructure/
    in-memory-project.repository.ts       — In-memory adapter
    sqlite-project.repository.ts          — SQLite stub
    project-repository.contract.spec.ts   — Contract tests
  index.ts                       — Barrel export
```

---

## Prerequisites

- `@kernel` path alias configured in `tsconfig.json` and `vitest.config.ts` (done in S01)
- Kernel base classes available: Entity, AggregateRoot, DomainEvent, Result, schemas, errors, EVENT_NAMES

---

## Wave 0 (parallel — no deps)

### T01: Create ProjectPropsSchema and types
**Files:** Create `src/hexagons/project/domain/project.schemas.ts`
**Traces to:** AC1, AC2, AC3
**Code:**
```typescript
import { z } from "zod";
import { IdSchema, TimestampSchema } from "@kernel";

export const ProjectPropsSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  vision: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ProjectProps = z.infer<typeof ProjectPropsSchema>;
export type ProjectDTO = ProjectProps;
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S05/T01): add ProjectPropsSchema and types`

### T02: Create ProjectInitializedEvent
**Files:** Create `src/hexagons/project/domain/project-initialized.event.ts`
**Traces to:** AC1
**Code:**
```typescript
import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";
import type { DomainEventProps } from "@kernel";

export class ProjectInitializedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.PROJECT_INITIALIZED;

  constructor(props: DomainEventProps) {
    super(props);
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S05/T02): add ProjectInitializedEvent`

---

## Wave 1 (depends on T01, T02)

### T03: Write failing tests for Project aggregate
**Files:** Create `src/hexagons/project/domain/project.aggregate.spec.ts`
**Traces to:** AC1, AC2, AC3, AC10
**Code:**
```typescript
import { describe, expect, it } from "vitest";
import { EVENT_NAMES } from "@kernel";
import { Project } from "./project.aggregate";

describe("Project", () => {
  const id = crypto.randomUUID();
  const now = new Date("2026-01-01T00:00:00Z");

  describe("init", () => {
    it("creates a valid project with correct properties", () => {
      const project = Project.init({ id, name: "My Project", vision: "A great vision", now });

      expect(project.id).toBe(id);
      expect(project.name).toBe("My Project");
      expect(project.vision).toBe("A great vision");
      expect(project.createdAt).toEqual(now);
      expect(project.updatedAt).toEqual(now);
    });

    it("emits ProjectInitializedEvent", () => {
      const project = Project.init({ id, name: "My Project", vision: "A great vision", now });
      const events = project.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.PROJECT_INITIALIZED);
      expect(events[0].aggregateId).toBe(id);
    });

    it("throws ZodError on empty name", () => {
      expect(() =>
        Project.init({ id, name: "", vision: "vision", now }),
      ).toThrow();
    });

    it("throws ZodError on invalid id", () => {
      expect(() =>
        Project.init({ id: "not-a-uuid", name: "name", vision: "vision", now }),
      ).toThrow();
    });
  });

  describe("updateVision", () => {
    it("updates vision and updatedAt", () => {
      const project = Project.init({ id, name: "My Project", vision: "Old vision", now });
      const later = new Date("2026-06-01T00:00:00Z");

      project.updateVision("New vision", later);

      expect(project.vision).toBe("New vision");
      expect(project.updatedAt).toEqual(later);
      expect(project.createdAt).toEqual(now);
    });
  });

  describe("reconstitute", () => {
    it("hydrates from props without emitting events", () => {
      const props = {
        id,
        name: "My Project",
        vision: "vision",
        createdAt: now,
        updatedAt: now,
      };
      const project = Project.reconstitute(props);

      expect(project.id).toBe(id);
      expect(project.name).toBe("My Project");
      expect(project.pullEvents()).toEqual([]);
    });

    it("throws on invalid props", () => {
      expect(() =>
        Project.reconstitute({
          id: "not-a-uuid",
          name: "name",
          vision: "vision",
          createdAt: now,
          updatedAt: now,
        }),
      ).toThrow();
    });
  });

  describe("toJSON", () => {
    it("returns a copy of props", () => {
      const project = Project.init({ id, name: "My Project", vision: "vision", now });
      const json = project.toJSON();

      expect(json).toEqual({
        id,
        name: "My Project",
        vision: "vision",
        createdAt: now,
        updatedAt: now,
      });
    });
  });
});
```
**Run:** `npx vitest run src/hexagons/project/domain/project.aggregate.spec.ts`
**Expect:** FAIL — `Cannot find module './project.aggregate'`

### T04: Implement Project aggregate
**Files:** Create `src/hexagons/project/domain/project.aggregate.ts`
**Traces to:** AC1, AC2, AC3, AC10
**Code:**
```typescript
import { AggregateRoot, type Id } from "@kernel";
import { ProjectInitializedEvent } from "./project-initialized.event";
import { ProjectPropsSchema, type ProjectProps } from "./project.schemas";

export class Project extends AggregateRoot<ProjectProps> {
  private constructor(props: ProjectProps) {
    super(props, ProjectPropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get vision(): string {
    return this.props.vision;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  static init(params: { id: Id; name: string; vision: string; now: Date }): Project {
    const project = new Project({
      id: params.id,
      name: params.name,
      vision: params.vision,
      createdAt: params.now,
      updatedAt: params.now,
    });
    project.addEvent(
      new ProjectInitializedEvent({
        id: crypto.randomUUID(),
        aggregateId: params.id,
        occurredAt: params.now,
      }),
    );
    return project;
  }

  updateVision(vision: string, now: Date): void {
    this.props.vision = vision;
    this.props.updatedAt = now;
  }

  static reconstitute(props: ProjectProps): Project {
    return new Project(props);
  }
}
```
**Run:** `npx vitest run src/hexagons/project/domain/project.aggregate.spec.ts`
**Expect:** PASS — all 7 tests passing
**Commit:** `feat(S05/T04): add Project aggregate with tests`

---

## Wave 2 (depends on T04 — parallel)

### T05: Create ProjectRepositoryPort
**Files:** Create `src/hexagons/project/domain/project-repository.port.ts`
**Traces to:** AC4, AC5
**Code:**
```typescript
import type { Id, Result } from "@kernel";
import type { PersistenceError } from "@kernel";
import type { Project } from "./project.aggregate";

export abstract class ProjectRepositoryPort {
  abstract save(project: Project): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Project | null, PersistenceError>>;
  abstract findSingleton(): Promise<Result<Project | null, PersistenceError>>;
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S05/T05): add ProjectRepositoryPort`

### T06: Create ProjectBuilder
**Files:** Create `src/hexagons/project/domain/project.builder.ts`
**Traces to:** AC8
**Code:**
```typescript
import { faker } from "@faker-js/faker";
import { Project } from "./project.aggregate";
import type { ProjectProps } from "./project.schemas";

export class ProjectBuilder {
  private _id: string = faker.string.uuid();
  private _name: string = faker.company.name();
  private _vision: string = faker.lorem.sentence();
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withName(name: string): this {
    this._name = name;
    return this;
  }

  withVision(vision: string): this {
    this._vision = vision;
    return this;
  }

  build(): Project {
    return Project.init({
      id: this._id,
      name: this._name,
      vision: this._vision,
      now: this._now,
    });
  }

  buildProps(): ProjectProps {
    return {
      id: this._id,
      name: this._name,
      vision: this._vision,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S05/T06): add ProjectBuilder with Faker defaults`

---

## Wave 3 (depends on T05, T06 — parallel)

### T07: Implement InMemoryProjectRepository
**Files:** Create `src/hexagons/project/infrastructure/in-memory-project.repository.ts`
**Traces to:** AC4, AC5, AC6
**Code:**
```typescript
import { type Result, err, ok, PersistenceError } from "@kernel";
import type { Id } from "@kernel";
import { Project } from "../domain/project.aggregate";
import { ProjectRepositoryPort } from "../domain/project-repository.port";
import type { ProjectProps } from "../domain/project.schemas";

export class InMemoryProjectRepository extends ProjectRepositoryPort {
  private store = new Map<string, ProjectProps>();

  async save(project: Project): Promise<Result<void, PersistenceError>> {
    const props = project.toJSON();
    for (const [existingId] of this.store) {
      if (existingId !== props.id) {
        return err(
          new PersistenceError(
            "Project singleton violated: a different project already exists",
          ),
        );
      }
    }
    this.store.set(props.id, props);
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Project | null, PersistenceError>> {
    const props = this.store.get(id);
    if (!props) return ok(null);
    return ok(Project.reconstitute(props));
  }

  async findSingleton(): Promise<Result<Project | null, PersistenceError>> {
    const entries = [...this.store.values()];
    if (entries.length === 0) return ok(null);
    return ok(Project.reconstitute(entries[0]));
  }

  seed(project: Project): void {
    this.store.set(project.id, project.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S05/T07): add InMemoryProjectRepository`

### T08: Create SqliteProjectRepository stub
**Files:** Create `src/hexagons/project/infrastructure/sqlite-project.repository.ts`
**Traces to:** AC7
**Code:**
```typescript
import type { Id, Result } from "@kernel";
import type { PersistenceError } from "@kernel";
import type { Project } from "../domain/project.aggregate";
import { ProjectRepositoryPort } from "../domain/project-repository.port";

export class SqliteProjectRepository extends ProjectRepositoryPort {
  save(_project: Project): Promise<Result<void, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findById(_id: Id): Promise<Result<Project | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findSingleton(): Promise<Result<Project | null, PersistenceError>> {
    throw new Error("Not implemented");
  }
}
```
**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors
**Commit:** `feat(S05/T08): add SqliteProjectRepository stub`

---

## Wave 4 (depends on T07)

### T09: Write and run contract test suite
**Files:** Create `src/hexagons/project/infrastructure/project-repository.contract.spec.ts`
**Traces to:** AC4, AC5, AC6, AC10
**Code:**
```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { isOk, isErr } from "@kernel";
import { ProjectBuilder } from "../domain/project.builder";
import { InMemoryProjectRepository } from "./in-memory-project.repository";
import type { ProjectRepositoryPort } from "../domain/project-repository.port";

function runContractTests(
  name: string,
  factory: () => ProjectRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: ProjectRepositoryPort & { reset(): void };
    const builder = new ProjectBuilder();

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findById roundtrip", async () => {
      const project = builder.build();
      const saveResult = await repo.save(project);
      expect(isOk(saveResult)).toBe(true);

      const findResult = await repo.findById(project.id);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data!.id).toBe(project.id);
        expect(findResult.data!.name).toBe(project.name);
        expect(findResult.data!.vision).toBe(project.vision);
      }
    });

    it("findSingleton returns null when empty", async () => {
      const result = await repo.findSingleton();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("findSingleton returns project after save", async () => {
      const project = builder.build();
      await repo.save(project);

      const result = await repo.findSingleton();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBeNull();
        expect(result.data!.id).toBe(project.id);
      }
    });

    it("save rejects when a different project already exists", async () => {
      const project1 = new ProjectBuilder().withName("Project 1").build();
      const project2 = new ProjectBuilder().withName("Project 2").build();

      await repo.save(project1);
      const result = await repo.save(project2);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("singleton");
      }
    });

    it("save allows updating the same project", async () => {
      const project = builder.build();
      await repo.save(project);

      project.updateVision("Updated vision", new Date());
      const result = await repo.save(project);
      expect(isOk(result)).toBe(true);
    });

    it("findById returns null for unknown id", async () => {
      const result = await repo.findById(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });
  });
}

runContractTests("InMemoryProjectRepository", () => new InMemoryProjectRepository());
```
**Run:** `npx vitest run src/hexagons/project/infrastructure/project-repository.contract.spec.ts`
**Expect:** PASS — 6/6 tests passing
**Commit:** `test(S05/T09): add repository contract test suite`

---

## Wave 5 (depends on all)

### T10: Create barrel export and verify
**Files:** Create `src/hexagons/project/index.ts`
**Traces to:** AC9, AC11
**Code:**
```typescript
export type { ProjectDTO } from "./domain/project.schemas";
export { ProjectPropsSchema } from "./domain/project.schemas";
export { ProjectRepositoryPort } from "./domain/project-repository.port";
export { ProjectInitializedEvent } from "./domain/project-initialized.event";
```
**Run:** `npx biome check src/hexagons/project/` then `npx vitest run src/hexagons/project/`
**Expect:** PASS — biome clean, all tests pass
**Commit:** `feat(S05/T10): add project hexagon barrel export`

---

## AC Traceability

| AC | Tasks |
|---|---|
| AC1: init() creates valid project + emits event | T01, T02, T03, T04 |
| AC2: updateVision() updates vision + updatedAt | T01, T03, T04 |
| AC3: reconstitute() hydrates without events | T01, T03, T04 |
| AC4: Singleton enforcement | T05, T07, T09 |
| AC5: InMemory passes contract tests | T07, T09 |
| AC6: seed() and reset() test helpers | T07, T09 |
| AC7: SQLite stub with correct interface | T08 |
| AC8: Builder with Faker defaults | T06 |
| AC9: Barrel exports only ports, events, DTOs | T10 |
| AC10: All tests pass | T03, T04, T09 |
| AC11: biome check passes | T10 |

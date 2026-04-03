# M01-S05: Project Hexagon

## Problem

The first hexagon needs to be built on top of the kernel (S01-S04). Project is the simplest aggregate (singleton, two business methods) making it ideal for establishing the hexagon pattern that Milestone and Slice hexagons will follow.

## Approach

Flat hexagon structure with domain/ and infrastructure/ subdirectories. Tests colocated. Contract test pattern for repository adapters. SQLite adapter stubbed (not implemented) until SQLite infrastructure is wired in a later slice.

## Design

### Directory Structure

```
src/hexagons/project/
  domain/
    project.aggregate.ts
    project.aggregate.spec.ts
    project.schemas.ts
    project-initialized.event.ts
    project-repository.port.ts
    project.builder.ts
  infrastructure/
    in-memory-project.repository.ts
    sqlite-project.repository.ts
    project-repository.contract.spec.ts
  index.ts
```

### Schemas

```typescript
// domain/project.schemas.ts
import { z } from 'zod';
import { IdSchema, TimestampSchema } from '../../kernel';

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

### Aggregate Root

```typescript
// domain/project.aggregate.ts
export class Project extends AggregateRoot<ProjectProps> {
  private constructor(props: ProjectProps) {
    super(props, ProjectPropsSchema);
  }

  get id(): string;
  get name(): string;
  get vision(): string;
  get createdAt(): Date;
  get updatedAt(): Date;

  static init(params: { id: Id; name: string; vision: string; now: Date }): Project;
  updateVision(vision: string, now: Date): void;  // simple assignment, no re-validation
  static reconstitute(props: ProjectProps): Project;  // throws on invalid props (programming error)
}
```

- `init()` creates a new Project and emits `ProjectInitializedEvent`
- `updateVision()` is a simple assignment of vision and updatedAt (no re-validation needed since the schema has no constraints beyond `z.string()`)
- `reconstitute()` hydrates from persistence without emitting events. Throws on invalid props (corrupted data = programming error, not domain error)

### Domain Event

```typescript
// domain/project-initialized.event.ts
export class ProjectInitializedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.PROJECT_INITIALIZED;
}
```

### Repository Port

```typescript
// domain/project-repository.port.ts
export abstract class ProjectRepositoryPort {
  abstract save(project: Project): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Project | null, PersistenceError>>;
  abstract findSingleton(): Promise<Result<Project | null, PersistenceError>>;
}
```

Singleton enforcement lives in the repository contract:
- `save()` returns `err(new PersistenceError("Project singleton violated: a different project already exists"))` if a different project already exists
- `findSingleton()` returns the one project or null

Serialization: repositories use `project.toJSON()` (inherited from `Entity`) to get `ProjectProps` for storage.

### InMemoryProjectRepository

```typescript
// infrastructure/in-memory-project.repository.ts
export class InMemoryProjectRepository extends ProjectRepositoryPort {
  private store = new Map<string, ProjectProps>();

  seed(project: Project): void;  // test helper
  reset(): void;                 // test helper
}
```

### SqliteProjectRepository (Stub)

```typescript
// infrastructure/sqlite-project.repository.ts
export class SqliteProjectRepository extends ProjectRepositoryPort {
  // All methods throw 'Not implemented'
  // Wired when SQLite infrastructure is added
}
```

### Contract Test Suite

```typescript
// infrastructure/project-repository.contract.spec.ts
// Shared suite run against InMemoryProjectRepository (and later SQLite)
```

Tests:
- save + findById roundtrip
- findSingleton returns null when empty
- findSingleton returns project after save
- save rejects when a different project already exists (singleton invariant)
- findById returns null for unknown id

### Builder

```typescript
// domain/project.builder.ts
export class ProjectBuilder {
  withName(name: string): this;
  withVision(vision: string): this;
  withId(id: string): this;
  build(): Project;
  buildProps(): ProjectProps;
}
```

Faker-based defaults for all fields. `build()` uses `Project.init()`. `buildProps()` returns raw props for reconstitution tests.

### Barrel Export

```typescript
// index.ts
export type { ProjectDTO } from './domain/project.schemas';
export { ProjectPropsSchema } from './domain/project.schemas';
export { ProjectRepositoryPort } from './domain/project-repository.port';
export { ProjectInitializedEvent } from './domain/project-initialized.event';
// Project aggregate is NOT exported (internal to hexagon)
```

## Acceptance Criteria

- [x] AC1: `Project.init()` creates a valid project and emits `ProjectInitializedEvent`
- [x] AC2: `Project.updateVision()` updates vision and updatedAt
- [x] AC3: `Project.reconstitute()` hydrates from props without emitting events
- [x] AC4: Singleton enforcement: save rejects when a different project already exists
- [x] AC5: InMemoryProjectRepository passes all contract tests
- [x] AC6: InMemoryProjectRepository has `seed()` and `reset()` test helpers
- [x] AC7: SqliteProjectRepository stub exists with correct interface
- [x] AC8: ProjectBuilder produces valid Projects with Faker defaults
- [x] AC9: Barrel exports only ports, events, and DTOs (not the aggregate)
- [x] AC10: All tests pass: aggregate, builder, contract suite
- [x] AC11: `biome check` passes on all new files

## Non-Goals

- Working SQLite adapter (stubbed only)
- Application-layer use cases (no use cases needed for Project)
- Cross-hexagon wiring (Project is standalone)

## Dependencies

- kernel/ base classes (Entity, AggregateRoot, DomainEvent, Result, schemas, errors, event names)

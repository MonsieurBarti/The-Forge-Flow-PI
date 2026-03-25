# M01: Kernel + Entity Stack

## Goal

Build the foundational DDD building blocks and the first three hexagons (Project, Milestone, Slice) with full test coverage.

## Slices

### M01-S01: Project scaffolding, Biome & Vitest

**Requirements:** R07, R08
**Dependencies:** none
**Complexity:** F-lite

- TypeScript project setup (package.json, tsconfig.json)
- Biome linting and formatting config with hexagon import boundary rules
- Vitest configuration with colocated test pattern
- Source directory structure: `src/kernel/`, `src/hexagons/`

**AC:**
- `biome check` passes
- `vitest run` executes (even with zero tests)
- Hexagon import boundary lint rules are configured

---

### M01-S02: Kernel base classes

**Requirements:** R01
**Dependencies:** M01-S01
**Complexity:** F-lite

- `Entity<TProps>` abstract base with `id` accessor and `toJSON()`
- `AggregateRoot<TProps>` extending Entity with domain event collection (`addEvent`, `pullEvents`)
- `ValueObject<TProps>` with structural equality (`equals`)
- `DomainEvent` abstract base with `DomainEventPropsSchema` (id, aggregateId, occurredAt, correlationId, causationId)
- `Result<T, E>` discriminated union with `isOk()`, `isErr()`, `match()` utilities

**AC:**
- All base classes are generic, Zod-validated, and independently unit-tested
- Result type used for all fallible operations (no thrown exceptions in domain layer)

---

### M01-S03: Kernel schemas & ports

**Requirements:** R02
**Dependencies:** M01-S02
**Complexity:** S

- `IdSchema` (UUID), `TimestampSchema` (coerced Date)
- `EventBusPort` abstract class (publish, subscribe)
- `DateProviderPort` abstract class (now)
- `GitPort` abstract class (listBranches, createBranch, showFile, log, status, commit)
- `GitHubPort` abstract class (createPullRequest, listPullRequests, addComment)
- `StateSyncPort` abstract class (push, pull, markDirty)

**AC:**
- All schemas export both the Zod schema and inferred TypeScript type
- All ports are abstract classes (not interfaces) for DI compatibility

---

### M01-S04: Kernel errors & event names

**Requirements:** R03
**Dependencies:** M01-S02
**Complexity:** S

- `BaseDomainError` abstract extending Error with `code` string and optional `metadata`
- `PersistenceError`, `GitError`, `GitHubError`, `SyncError` concrete errors
- Event name constants (`EVENT_NAMES` as `const` object) with `EventName` type

**AC:**
- Error codes follow `DOMAIN.SPECIFIC` format (e.g., `GIT.BRANCH_NOT_FOUND`)
- Event names are compile-time checked (no string typos possible)

---

### M01-S05: Project hexagon

**Requirements:** R04
**Dependencies:** M01-S03, M01-S04
**Complexity:** F-full

- `Project` aggregate root with `ProjectPropsSchema` (id, name, vision, createdAt, updatedAt)
- `init()` static factory, `updateVision()` business method
- `ProjectInitializedEvent` domain event
- `ProjectRepositoryPort` abstract class (save, findById, findSingleton)
- `SqliteProjectRepository` and `InMemoryProjectRepository` adapters
- `ProjectBuilder` (Faker-based test builder)
- Public barrel (`index.ts`) exporting only ports, events, DTOs

**AC:**
- Singleton enforcement: only one Project per repo
- In-memory adapter has `seed()`, `reset()` test helpers
- All tests pass: entity, builder, both adapters
- Port contract test pattern established

---

### M01-S06: Milestone hexagon

**Requirements:** R05
**Dependencies:** M01-S05
**Complexity:** F-full

- `Milestone` aggregate root with `MilestonePropsSchema` (id, projectId, label, title, description, status, branch, timestamps)
- `MilestoneStatusSchema`: open, in_progress, closed
- `createNew()` static factory, `activate()`, `close()` business methods
- `MilestoneCreatedEvent`, `MilestoneClosedEvent` domain events
- `MilestoneRepositoryPort`, SQLite + in-memory adapters
- `MilestoneBuilder`
- Label format: `M01`, `M02`, ... | Branch naming: `milestone/M01`

**AC:**
- Status transitions validated (open -> in_progress -> closed only)
- Label auto-generation from milestone number
- Both adapters pass contract tests

---

### M01-S07: Slice hexagon

**Requirements:** R06
**Dependencies:** M01-S06
**Complexity:** F-full

- `Slice` aggregate root with `SlicePropsSchema` (id, milestoneId, label, title, description, status, complexity, specPath, planPath, researchPath, timestamps)
- `SliceStatusVO` value object implementing state machine with 8 states: discussing, researching, planning, executing, verifying, reviewing, completing, closed
- `ComplexityTierSchema`: S, F-lite, F-full with classification logic
- `createNew()`, `transitionTo()`, `classify()` business methods
- `SliceCreatedEvent`, `SliceStatusChangedEvent` domain events
- `InvalidTransitionError`, `SliceNotFoundError`
- `SliceRepositoryPort`, SQLite + in-memory adapters
- `SliceBuilder`
- Label format: `M01-S01` | Back-edges: planning->planning, verifying->executing, reviewing->executing

**AC:**
- State machine rejects invalid transitions with `InvalidTransitionError`
- All valid transitions including back-edges are tested
- Complexity classification: S-tier requires ALL criteria (<=1 file, 0 new files, no investigation, no architecture impact, 0 unknowns)
- Both adapters pass contract tests

## Dependency Graph

```
S01 --> S02 --> S03 --\
                S04 --+--> S05 --> S06 --> S07
```

S03 and S04 are parallelizable (both depend only on S02).

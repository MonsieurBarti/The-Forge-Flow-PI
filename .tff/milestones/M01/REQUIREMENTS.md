# M01: Kernel + Entity Stack

## Goal

Build the foundational DDD building blocks and the first three hexagons (Project, Milestone, Slice) with full test coverage.

## Requirements

### R01: Kernel Base Classes

- `Entity<TProps>` abstract base with `id` accessor and `toJSON()`
- `AggregateRoot<TProps>` extending Entity with domain event collection (`addEvent`, `pullEvents`)
- `ValueObject<TProps>` with structural equality (`equals`)
- `DomainEvent` abstract base with `DomainEventPropsSchema` (id, aggregateId, occurredAt, correlationId, causationId)
- `Result<T, E>` discriminated union (`{ ok: true, data: T } | { ok: false, error: E }`) -- no exceptions for domain errors
- `isOk()`, `isErr()`, `match()` utility functions

**AC:**
- All base classes are generic, Zod-validated, and independently unit-tested
- Result type used for all fallible operations (no thrown exceptions in domain layer)

### R02: Kernel Schemas and Ports

- `IdSchema` (UUID), `TimestampSchema` (coerced Date)
- `EventBusPort` abstract class (publish, subscribe)
- `DateProviderPort` abstract class (now)
- `GitPort` abstract class (listBranches, createBranch, showFile, log, status, commit)
- `GitHubPort` abstract class (createPullRequest, listPullRequests, addComment)
- `StateSyncPort` abstract class (push, pull, markDirty)

**AC:**
- All schemas export both the Zod schema and inferred TypeScript type
- All ports are abstract classes (not interfaces) for DI compatibility

### R03: Kernel Errors

- `BaseDomainError` abstract extending Error with `code` string and optional `metadata`
- `PersistenceError`, `GitError`, `GitHubError`, `SyncError` concrete errors
- Event name constants (`EVENT_NAMES` as `const` object) with `EventName` type

**AC:**
- Error codes follow `DOMAIN.SPECIFIC` format (e.g., `GIT.BRANCH_NOT_FOUND`)
- Event names are compile-time checked (no string typos possible)

### R04: Project Hexagon

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

### R05: Milestone Hexagon

- `Milestone` aggregate root with `MilestonePropsSchema` (id, projectId, label, title, description, status, branch, timestamps)
- `MilestoneStatusSchema`: open, in_progress, closed
- `createNew()` static factory, `activate()`, `close()` business methods
- `MilestoneCreatedEvent`, `MilestoneClosedEvent` domain events
- `MilestoneRepositoryPort`, SQLite + in-memory adapters
- `MilestoneBuilder`
- Label format: `M01`, `M02`, ...
- Branch naming: `milestone/M01`

**AC:**
- Status transitions validated (open -> in_progress -> closed only)
- Label auto-generation from milestone number

### R06: Slice Hexagon

- `Slice` aggregate root with `SlicePropsSchema` (id, milestoneId, label, title, description, status, complexity, specPath, planPath, researchPath, timestamps)
- `SliceStatusVO` value object implementing state machine with 8 states: discussing, researching, planning, executing, verifying, reviewing, completing, closed
- `ComplexityTierSchema`: S, F-lite, F-full with classification logic
- `createNew()`, `transitionTo()`, `classify()` business methods
- `SliceCreatedEvent`, `SliceStatusChangedEvent` domain events
- `InvalidTransitionError`, `SliceNotFoundError`
- `SliceRepositoryPort`, SQLite + in-memory adapters
- `SliceBuilder`
- Label format: `M01-S01`
- Back-edges: planning->planning, verifying->executing, reviewing->executing

**AC:**
- State machine rejects invalid transitions with `InvalidTransitionError`
- All valid transitions including back-edges are tested
- Complexity classification: S-tier requires ALL criteria (<=1 file, 0 new files, no investigation, no architecture impact, 0 unknowns)

### R07: Biome Configuration

- Biome linting and formatting config (`biome.json`)
- Hexagon import boundary rules: hexagons import only from `kernel/` and own internals
- No cross-hexagon internal imports (only via barrel exports)

**AC:**
- `biome check` passes on all source files
- Importing from another hexagon's internal files produces a lint error

### R08: Testing Foundation

- Vitest configuration (`vitest.config.ts`)
- Colocated tests (`*.spec.ts` next to source files)
- Faker-based builders next to entities
- In-memory adapters next to SQLite adapters in `infrastructure/`
- Port contract test pattern (reusable test suite any adapter must pass)

**AC:**
- `vitest run` executes all tests successfully
- Each adapter passes the same contract test suite

# M05-S02: Fresh-Reviewer Enforcement

## Problem

When the review pipeline dispatches reviewer agents, nothing prevents the same agent that executed the slice from reviewing its own work. Self-review is a known blind-spot -- the agent that wrote the code has the same biases when reviewing it. Enforcement must be a hard gate (error, not warning).

## Approach

Synchronous cross-hexagon query with per-dispatch cache.

- Review hexagon defines `ExecutorQueryPort` (outbound port in domain layer)
- `FreshReviewerService` domain service: takes candidate `reviewerId` + `sliceId`, queries executors via port, rejects if candidate in executor set
- Execution hexagon adds `GetSliceExecutorsUseCase` (application layer, follows existing `*.use-case.ts` convention), exposed via public API
- `CachedExecutorQueryAdapter` in Review infra: implements port, calls Execution's use case, caches result per sliceId (in-memory Map, no TTL -- single dispatch lifecycle)
- Modifies existing `FreshReviewerViolationError` (from S01) to include `executors` set for diagnostics
- New `ExecutorQueryError` for port failure propagation
- Executor scope: all unique `agentIdentity` values from checkpoint `executorLog`

## Architecture

### Review Hexagon -- Domain Layer

```
review/domain/
  ports/
    executor-query.port.ts              <- NEW: ExecutorQueryPort
  services/
    fresh-reviewer.service.ts           <- NEW: FreshReviewerService
  errors/
    fresh-reviewer-violation.error.ts   <- MODIFY: add executors field
    executor-query.error.ts             <- NEW: ExecutorQueryError
```

**`ExecutorQueryPort`** (abstract class):
- `abstract getSliceExecutors(sliceId: string): Promise<Result<ReadonlySet<string>, ExecutorQueryError>>`

**`FreshReviewerService`** (domain service):
- Constructor: `(executorQueryPort: ExecutorQueryPort)`
- `enforce(sliceId: string, reviewerId: string): Promise<Result<void, FreshReviewerViolationError | ExecutorQueryError>>`
- Fail-closed: if port returns error, propagate (never return Ok)

**`FreshReviewerViolationError`** (MODIFY existing from S01):
- Current shape: `{ reviewerId, sliceId }`
- New shape: `{ reviewerId, sliceId, executors: ReadonlySet<string> }`
- Extends `BaseDomainError` (unchanged), code `REVIEW.FRESH_REVIEWER_VIOLATION` (unchanged)

**`ExecutorQueryError`** (NEW):
- Extends `BaseDomainError`
- Code: `REVIEW.EXECUTOR_QUERY_FAILED`
- Wraps underlying cause (e.g., `PersistenceError` from checkpoint repo)

### Review Hexagon -- Infrastructure Layer

```
review/infrastructure/
  cached-executor-query.adapter.ts      <- NEW: CachedExecutorQueryAdapter
```

- Implements `ExecutorQueryPort`
- Constructor: `(queryFn: (sliceId: string) => Promise<Result<ReadonlySet<string>, ExecutorQueryError>>)`
- Internal `Map<string, ReadonlySet<string>>` cache; populated on first call per sliceId
- Different sliceId triggers new query call

### Execution Hexagon -- Application Layer

```
execution/application/
  get-slice-executors.use-case.ts       <- NEW: GetSliceExecutorsUseCase
```

- Constructor: `(checkpointRepo: CheckpointRepositoryPort)`
- `execute(sliceId: string): Promise<Result<ReadonlySet<string>, PersistenceError>>`
- Uses `checkpointRepo.findBySliceId()` -> extracts unique `agentIdentity` from `executorLog` -> `ReadonlySet<string>`
- Empty set if no checkpoint found (slice not yet executed)

### Execution Hexagon -- Public API

- Export `GetSliceExecutorsUseCase` from `execution/index.ts`

### Wiring (composition root)

- Composition root instantiates `GetSliceExecutorsUseCase` with checkpoint repo
- Wraps it in `CachedExecutorQueryAdapter`: `new CachedExecutorQueryAdapter((sliceId) => useCase.execute(sliceId).mapErr(toExecutorQueryError))`
- Injects adapter into `FreshReviewerService`
- Composition root wiring itself is NOT in scope for this slice -- S04 (multi-stage pipeline) will wire it when constructing `ConductReviewUseCase`

## Error Handling

| Scenario | Behavior |
|---|---|
| Slice never executed (no checkpoint) | Empty set -> any reviewer is valid (Ok) |
| Executor query fails (persistence error) | `ExecutorQueryError` propagated -> fail-closed (block review) |
| All agents in executor set | `FreshReviewerViolationError` with full set -- caller escalates to human |
| Cache hit for same sliceId | Return cached set, skip query |

**Fail-closed policy**: if executor query fails, review dispatch MUST NOT proceed. No fallback to "allow anyway".

## Testing Strategy

| Layer | Target | Method |
|---|---|---|
| Domain unit | `FreshReviewerService.enforce()` | Stub `ExecutorQueryPort`: candidate in executors -> error, not in -> ok, empty set -> ok, port failure -> propagate |
| Domain unit | `FreshReviewerViolationError` | Carries reviewerId, sliceId, executors in metadata |
| Application unit | `GetSliceExecutorsUseCase` | `InMemoryCheckpointRepository`: seeded executor log -> extracts unique identities; missing checkpoint -> empty set |
| Infrastructure unit | `CachedExecutorQueryAdapter` | Spy query fn: first call invokes, second same-sliceId cached (call count = 1), different sliceId invokes again |
| Integration | Cross-hexagon flow | Wire in-memory repos. Seed checkpoint -> call enforce() -> verify rejection/acceptance |

## Acceptance Criteria

1. **Self-review blocked**: `enforce()` returns `FreshReviewerViolationError` when `reviewerId` in `sliceExecutors`
2. **Fresh reviewer allowed**: `enforce()` returns `Ok<void>` when `reviewerId` not in `sliceExecutors`
3. **No-checkpoint passthrough**: `enforce()` returns `Ok<void>` when no checkpoint exists for slice (empty executor set)
4. **Fail-closed on query error**: `enforce()` returns `ExecutorQueryError` when `ExecutorQueryPort` fails -- never `Ok`
5. **Port boundary respected**: `review/domain/` contains zero imports from `execution/` (verified by import-boundary test)
6. **Cache hit**: second call to `getSliceExecutors` for same sliceId does not invoke underlying query fn
7. **Cache miss on new key**: call to `getSliceExecutors` for different sliceId invokes query fn (cache is per-key)

## Non-Goals

- Reviewer selection/assignment logic (S04)
- Fixer agent identity tracking (S07)
- Persistent cache or TTL (cache lives for single dispatch cycle)
- UI for enforcement violations (S05)
- Composition root wiring (S04)
- Input validation for empty reviewerId (upstream concern)

# M04-S05 Cost Tracking -- Research

## 1. JSONL Repository Pattern (closest analog for MetricsRepository)

### Source files
- Port: `src/hexagons/execution/domain/ports/journal-repository.port.ts`
- JSONL adapter: `src/hexagons/execution/infrastructure/jsonl-journal.repository.ts`
- In-memory adapter: `src/hexagons/execution/infrastructure/in-memory-journal.repository.ts`
- Contract tests: `src/hexagons/execution/infrastructure/journal-repository.contract.spec.ts`
- JSONL-specific tests: `src/hexagons/execution/infrastructure/jsonl-journal.repository.spec.ts`
- In-memory-specific tests: `src/hexagons/execution/infrastructure/in-memory-journal.repository.spec.ts`

### Key patterns

**Port is an abstract class** (not an interface):
```typescript
export abstract class JournalRepositoryPort {
  abstract append(...): Promise<Result<number, JournalWriteError>>;
  abstract readAll(...): Promise<Result<readonly JournalEntry[], JournalReadError>>;
  // ...
}
```

**JSONL adapter -- append**:
- Takes `basePath` via constructor
- `mkdir(basePath, { recursive: true })` before first write
- `appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8")`
- Returns `Result<T, Error>` pattern everywhere -- never throws

**JSONL adapter -- read**:
- `readFile(filePath, "utf-8")`
- ENOENT -> `ok([])` (empty array, not error)
- Splits on `\n`, filters empty lines
- Per-line `JSON.parse` + `Schema.parse(raw)` (strict Zod parse, not safeParse)
- On corrupt line: returns `err(JournalReadError(...))` with `lineNumber` and `rawContent` metadata

**GOTCHA**: The journal JSONL repo uses strict `parse` per line and returns error on first corrupt line (line 63-69). The SPEC says the metrics repo should use `safeParse` and skip corrupt lines. This is a deliberate difference -- the metrics repo is more lenient.

**JSONL adapter -- file naming**: Journal uses `${sliceId}.jsonl` per slice. Metrics uses a single `metrics.jsonl` file (per spec data flow).

**In-memory adapter**:
- Uses `Map<string, Entry[]>` as store
- Has `seed(sliceId, entries)` for test setup
- Has `reset()` for `beforeEach` cleanup
- Always returns `ok(...)` -- never errors

**Contract test pattern**:
```typescript
export function runJournalContractTests(
  name: string,
  factory: () => JournalRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: JournalRepositoryPort & { reset(): void };
    beforeEach(() => { repo = factory(); repo.reset(); });
    // shared tests...
  });
}
```
- Factory returns `Port & { reset(): void }` intersection type
- Contract tests imported and called from each adapter's own spec file
- JSONL spec file adds adapter-specific tests (persistence, corrupt line detection)

**JSONL spec file setup**:
```typescript
let basePath: string;
beforeAll(async () => { basePath = await mkdtemp(join(tmpdir(), "tff-journal-")); });
afterAll(async () => { await rm(basePath, { recursive: true, force: true }); });
runJournalContractTests("JsonlJournalRepository", () => new JsonlJournalRepository(basePath));
```

### Differences for MetricsRepository
| Journal | Metrics |
|---|---|
| One file per slice (`${sliceId}.jsonl`) | Single file (`metrics.jsonl`) |
| Keyed by sliceId in all methods | `readBySlice`, `readByMilestone`, `readAll` |
| Has `seq` (monotonic sequence) | No seq needed |
| Strict parse -> error on corrupt | safeParse -> skip corrupt with warning |
| `append` returns seq number | `append` returns `void` |
| Error types: `JournalReadError`/`JournalWriteError` | `PersistenceError` (per spec) |

### `isNodeError` helper
Defined locally in `jsonl-journal.repository.ts` (line 11-16). The metrics adapter will need the same helper for ENOENT detection. Consider extracting or copying.

---

## 2. Event System

### InProcessEventBus
- File: `src/kernel/infrastructure/in-process-event-bus.ts`
- `Map<EventName, Array<(event: DomainEvent) => Promise<void>>>` as handler storage
- `subscribe(eventType, handler)` -- pushes to array
- `publish(event)` -- iterates handlers sequentially, catches errors per handler, logs via `LoggerPort`
- Errors are caught and logged but do NOT propagate -- handlers are fire-and-forget from publisher's perspective

### JournalEventHandler (pattern for RecordTaskMetricsUseCase)
- File: `src/hexagons/execution/application/journal-event-handler.ts`
- Constructor takes repository port: `constructor(private readonly journalRepo: JournalRepositoryPort)`
- Has `register(eventBus: EventBusPort): void` method that calls `eventBus.subscribe(...)` for each event
- Each handler does `instanceof` type narrowing: `if (!(event instanceof CheckpointSavedEvent)) return;`
- Handlers are `private async` methods
- No return value from handlers (fire-and-forget via event bus)

### JournalEventHandler spec
- File: `src/hexagons/execution/application/journal-event-handler.spec.ts`
- Uses `InProcessEventBus` + `SilentLoggerAdapter` (not mocks)
- Uses `InMemoryJournalRepository` as the real in-memory adapter
- Creates event, publishes via bus, then asserts repository state
- Pattern:
```typescript
let repo: InMemoryJournalRepository;
let bus: InProcessEventBus;
let handler: JournalEventHandler;
beforeEach(() => {
  repo = new InMemoryJournalRepository();
  bus = new InProcessEventBus(new SilentLoggerAdapter());
  handler = new JournalEventHandler(repo);
  handler.register(bus);
});
```

### DomainEvent base class
- File: `src/kernel/domain-event.base.ts`
- `DomainEventPropsSchema`: `{ id: IdSchema, aggregateId: IdSchema, occurredAt: TimestampSchema, correlationId?: IdSchema, causationId?: IdSchema }`
- Constructor parses props via schema
- Subclasses extend schema, call `super(parsed)`, assign additional fields

### CheckpointSavedEvent (pattern for TaskExecutionCompletedEvent)
- File: `src/hexagons/execution/domain/events/checkpoint-saved.event.ts`
- Extends `DomainEventPropsSchema` with additional fields
- Infers `Props` type from extended schema
- Constructor: `parse(props)` via schema, `super(parsed)`, assign fields
- `readonly eventName: EventName = EVENT_NAMES.CHECKPOINT_SAVED`
- Imports from `@kernel`: `DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName, IdSchema`

### TaskCompletedEvent (comparison)
- File: `src/hexagons/task/domain/events/task-completed.event.ts`
- Same pattern exactly
- Has `sliceId` but NOT `milestoneId`
- Lives in task hexagon, not execution hexagon

### EVENT_NAMES
- File: `src/kernel/event-names.ts`
- `as const` object with string literal values
- Format: `"domain.kebab-case-action"` (e.g., `"execution.checkpoint-saved"`)
- `EventName` type derived from object values
- `EventNameSchema` is a `z.enum([...all values...])`
- Currently 14 entries; spec says add `TASK_EXECUTION_COMPLETED = 'execution.task-execution-completed'`

### EVENT_NAMES spec
- File: `src/kernel/event-names.spec.ts`
- **GOTCHA**: Tests assert `Object.keys(EVENT_NAMES).toHaveLength(14)` -- adding a new event requires updating this to 15
- Tests all values are unique
- Tests format: `/^[a-z]+\.[a-z-]+$/`

---

## 3. Schema Patterns

### CheckpointPropsSchema
- File: `src/hexagons/execution/domain/checkpoint.schemas.ts`
- Imports `IdSchema`, `TimestampSchema` from `@kernel`
- Uses `z.object({...})` with named export
- Type inferred: `export type CheckpointProps = z.infer<typeof CheckpointPropsSchema>;`
- Schema spec: `src/hexagons/execution/domain/checkpoint.schemas.spec.ts`
  - Tests valid parse, defaults, rejections for invalid values
  - Uses `crypto.randomUUID()` for ID generation in tests

### CheckpointBuilder
- File: `src/hexagons/execution/domain/checkpoint.builder.ts`
- Uses `@faker-js/faker` for defaults
- Fluent `withX(x): this` pattern (returns `this` for chaining)
- Has `build()` that creates a domain object and `buildProps()` that returns raw props
- Private fields prefixed with underscore: `private _id`, `private _sliceId`

### AgentResultSchema
- File: `src/kernel/agents/agent-result.schema.ts`
- `AgentCostSchema`: `{ provider, modelId, inputTokens, outputTokens, costUsd }`
- `AgentResultSchema`: `{ taskId, agentType, success, output, filesChanged, cost: AgentCostSchema, durationMs, error? }`
- **Note**: `AgentResult` does NOT have `provider`/`modelId` at top level -- they're inside `cost`
- **Note**: `AgentResult` does NOT have `modelProfile` -- only provider/modelId from the actual API response

### AgentResultBuilder
- File: `src/kernel/agents/agent-result.builder.ts`
- Same fluent pattern with faker defaults
- `build()` method calls `AgentResultSchema.parse({...})` to validate

### ModelProfileNameSchema
- File: `src/kernel/schemas.ts` (line 12-13)
- `z.enum(["quality", "balanced", "budget"])`
- Exported from `@kernel` barrel at `src/kernel/index.ts`
- Also re-exported from `@hexagons/settings`

### AgentDispatchConfig
- File: `src/kernel/agents/agent-dispatch.schema.ts`
- Has `taskId`, `sliceId`, `agentType`, `model: ResolvedModelSchema`, etc.
- **Does NOT have `milestoneId`** -- this is intentional per spec; the orchestrator (S07) will need to carry `milestoneId` separately when emitting `TaskExecutionCompletedEvent`
- **Does NOT have `modelProfile`** -- only `model: { provider, modelId }` (the resolved model, not which profile it came from)

---

## 4. Barrel Export Pattern

### Execution hexagon barrel
- File: `src/hexagons/execution/index.ts`
- Organized by layer with comments: `// Application -- Use Cases`, `// Domain -- Schemas`, `// Domain -- Errors`, `// Domain -- Events`, `// Domain -- Ports`, `// Infrastructure -- Adapters`
- Exports use cases, schema types (as `type` imports), schema validators, errors, events, ports, and infrastructure adapters
- All adapters exported "for downstream test wiring"
- Types use `export type { ... }`, values use `export { ... }`

### New exports needed (per spec)
- `TaskMetricsSchema`, `TaskMetrics` type, `AggregatedMetricsSchema`, `AggregatedMetrics` type, `ModelBreakdownEntrySchema`
- `TaskExecutionCompletedEvent`
- `MetricsRepositoryPort`, `MetricsQueryPort`
- `RecordTaskMetricsUseCase`, `AggregateMetricsUseCase`
- `JsonlMetricsRepository`, `InMemoryMetricsRepository`
- `TaskMetricsBuilder`

---

## 5. Dependencies -- milestoneId Availability

### Key finding
- `AgentDispatchConfig` does NOT carry `milestoneId` (only `taskId` + `sliceId`)
- `AgentResult` does NOT carry `milestoneId`
- `milestoneId` lives on the `Slice` aggregate (`src/hexagons/slice/domain/slice.aggregate.ts`, line 23-24)
- The future orchestrator (`ExecuteSliceUseCase`, S07) will have `milestoneId` in its input context and must pass it through to `TaskExecutionCompletedEvent`
- No existing event carries `milestoneId` -- this is a new field being introduced on `TaskExecutionCompletedEvent`

### modelProfile availability
- `AgentDispatchConfig` has `model: { provider, modelId }` but NOT `modelProfile`
- The orchestrator resolves `modelProfile -> { provider, modelId }` via settings
- The orchestrator knows which profile was selected and must pass `modelProfile` on the event
- `ModelProfileNameSchema` is available from `@kernel` (`z.enum(["quality", "balanced", "budget"])`)

---

## 6. Test Patterns

### Use case specs
- File: `src/hexagons/execution/application/replay-journal.use-case.spec.ts`
- Uses a local `setup()` function (not `beforeEach`) that creates fresh instances:
  ```typescript
  function setup() {
    const repo = new InMemoryJournalRepository();
    const useCase = new ReplayJournalUseCase(repo);
    return { repo, useCase };
  }
  ```
- Uses `isOk`/`isErr` from `@kernel` for Result assertions
- Tests named with AC references: `"AC4 -- consistent journal + ...""`

- File: `src/hexagons/execution/application/rollback-slice.use-case.spec.ts`
- Creates mock ports as classes extending abstract ports (not vitest mocks)
- Mock classes implement all abstract methods with simple returns
- Has helper functions for creating test data
- Uses `expect(result.ok).toBe(true)` pattern alongside `isOk`/`isErr`

### Event handler spec pattern (most relevant for RecordTaskMetricsUseCase)
- File: `src/hexagons/execution/application/journal-event-handler.spec.ts`
- Uses real `InProcessEventBus` with `SilentLoggerAdapter`
- Uses real `InMemoryJournalRepository`
- Publishes events through the bus, then checks repository state
- This is the exact pattern for testing `RecordTaskMetricsUseCase`

### Contract test pattern
- Exported function that takes a name and factory
- Factory returns `Port & { reset(): void }`
- Each adapter spec file imports and calls the contract function
- Adapter-specific tests live in the adapter's own spec file

---

## 7. Error Pattern

### Domain errors
- All extend `BaseDomainError` from `@kernel`
- `BaseDomainError` extends `Error`, has abstract `code: string` and optional `metadata: Record<string, unknown>`
- Error codes follow `DOMAIN.ACTION_FAILURE` format (e.g., `JOURNAL.READ_FAILURE`, `JOURNAL.WRITE_FAILURE`)
- Defined in `src/hexagons/execution/domain/errors/` directory

### PersistenceError
- File: `src/kernel/errors/persistence.error.ts`
- Code: `"PERSISTENCE.FAILURE"`
- Generic persistence error, used across hexagons
- The spec says `MetricsRepositoryPort` uses `PersistenceError` (not custom errors like `JournalReadError`)

---

## 8. Import Style

All files use path aliases:
- `@kernel` -> `src/kernel/index.ts`
- `@kernel/schemas` -> `src/kernel/schemas.ts`
- `@kernel/agents` -> `src/kernel/agents/index.ts`
- `@kernel/domain-event.base` -> direct file import
- `@kernel/ports/event-bus.port` -> direct file import
- `@hexagons/slice/domain/events/...` -> direct file import within hexagons

Within the execution hexagon, relative imports are used (e.g., `../domain/ports/...`, `./journal-entry.schemas`).

---

## 9. Gotchas and Spec Divergences

1. **EVENT_NAMES count assertion**: `event-names.spec.ts` asserts exactly 14 entries. Adding `TASK_EXECUTION_COMPLETED` requires updating this to 15.

2. **Corrupt line handling differs**: Journal repo errors on first corrupt line. Spec says metrics repo should skip corrupt lines with warning. Must use `safeParse` + filter, not `parse` + try/catch.

3. **No milestoneId in dispatch pipeline**: Neither `AgentDispatchConfig` nor `AgentResult` carries `milestoneId`. The event must receive it from the orchestrator's context. For unit tests of `RecordTaskMetricsUseCase`, this is straightforward since we construct the event directly.

4. **PersistenceError vs custom errors**: The spec uses `PersistenceError` for the metrics port, unlike the journal port which has `JournalReadError`/`JournalWriteError`. This is simpler -- no new error classes needed.

5. **Single file vs per-slice files**: The journal uses one JSONL file per slice. The metrics repo uses a single `metrics.jsonl` file. The JSONL adapter constructor takes a file path, not a directory. `readBySlice`/`readByMilestone` filter in-memory after reading all entries.

6. **Result type usage**: All ports return `Result<T, E>`. The `ok`/`err` constructors and `isOk`/`isErr` guards are imported from `@kernel`.

7. **Builder schema validation**: Builders call `Schema.parse({...})` in their `build()` method to ensure the built object is valid. The `TaskMetricsBuilder` should do the same with `TaskMetricsSchema.parse({...})`.

8. **AgentResultSchema.agentType vs agentIdentity**: The spec notes the event uses `agentType` (from `AgentResultSchema`), not the older `agentIdentity` string. The current `AgentResultSchema` already uses `agentType: AgentTypeSchema`.

9. **Timestamp serialization**: The JSONL journal serializes dates: `timestamp instanceof Date ? timestamp.toISOString() : timestamp`. The metrics adapter will need similar treatment since `TimestampSchema` is `z.coerce.date()` which produces `Date` objects, but JSONL needs strings.

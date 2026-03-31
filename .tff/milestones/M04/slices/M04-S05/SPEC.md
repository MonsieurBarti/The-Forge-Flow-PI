# S05: Cost Tracking

## Problem

Agent dispatches produce cost data (tokens, USD) via `AgentResult` but it's discarded after the session. No way to track spend per-task, per-slice, or per-milestone. R06 requires persistent cost tracking with aggregation queries.

## Approach

Event-driven capture in the execution hexagon. A new `TaskExecutionCompletedEvent` carries the full `AgentResult` (including cost). A `MetricsCollectorService` subscribes and persists `TaskMetrics` entries to an append-only JSONL file. An `AggregateMetricsUseCase` provides per-slice/milestone query with in-memory aggregation. A cross-hexagon `MetricsQueryPort` is exported for future Intelligence hexagon consumption.

### Why event-driven

- Decouples dispatch from metrics — dispatch code doesn't know about persistence
- Consistent with existing event patterns (JournalEventHandler subscribes to TaskCompletedEvent)
- Testable: in-memory adapter + event bus stub

### Why JSONL over SQLite/JSON

- Append-only = crash-safe (no read-modify-write)
- One line per entry = grep-friendly, simple parsing
- Aggregation in-memory is fine for project-scale data (hundreds to low thousands of entries)

## Scope

### In scope
- `TaskMetricsSchema` (richer than original `CostEntrySchema`: includes model profile, retries, downshifted, reflectionPassed)
- `TaskExecutionCompletedEvent` in execution hexagon
- `MetricsRepositoryPort` + JSONL adapter + in-memory adapter
- `RecordTaskMetricsUseCase` (event subscriber → persist)
- `AggregateMetricsUseCase` (query by slice/milestone → aggregated totals)
- Cross-hexagon `MetricsQueryPort` exported via barrel
- Event name constant in kernel `EVENT_NAMES`

### Non-goals
- Budget enforcement / auto-downshift (settings hexagon + Improvement B)
- Metrics-informed suggestions UI (Intelligence hexagon, M05)
- Dashboard / visualization (M06 `/tff:progress`)

### Design divergence note
Design improvement spec (Improvement C) places `AggregateMetricsUseCase` in the Intelligence hexagon. We place it in the Execution hexagon because: (a) Intelligence hexagon is M05, (b) the data originates and is stored in Execution, (c) a cross-hexagon `MetricsQueryPort` lets Intelligence consume without owning. If M05 needs richer aggregation (suggestions, trend analysis), it can build on top of `MetricsQueryPort`.

## Schemas

### TaskMetricsSchema

```typescript
export const TaskMetricsModelSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  profile: ModelProfileNameSchema,
});

export const TaskMetricsSchema = z.object({
  taskId: IdSchema,
  sliceId: IdSchema,
  milestoneId: IdSchema,
  model: TaskMetricsModelSchema,
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
  }),
  costUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  success: z.boolean(),
  retries: z.number().int().nonnegative().default(0),
  downshifted: z.boolean().default(false),
  reflectionPassed: z.boolean().optional(),
  timestamp: TimestampSchema,
});
export type TaskMetrics = z.infer<typeof TaskMetricsSchema>;
```

### AggregatedMetricsSchema

```typescript
export const ModelBreakdownEntrySchema = z.object({
  modelId: z.string(),
  taskCount: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
});

export const AggregatedMetricsSchema = z.object({
  groupKey: z.object({
    sliceId: IdSchema.optional(),
    milestoneId: IdSchema.optional(),
  }),
  totalCostUsd: z.number().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  averageCostPerTask: z.number().nonnegative(),
  modelBreakdown: z.array(ModelBreakdownEntrySchema),
});
export type AggregatedMetrics = z.infer<typeof AggregatedMetricsSchema>;
```

### TaskExecutionCompletedEvent

```typescript
// execution/domain/events/task-execution-completed.event.ts
const TaskExecutionCompletedEventPropsSchema = DomainEventPropsSchema.extend({
  taskId: IdSchema,
  sliceId: IdSchema,
  milestoneId: IdSchema,
  waveIndex: z.number().int().min(0),
  modelProfile: ModelProfileNameSchema,     // Which profile the orchestrator selected
  agentResult: AgentResultSchema,           // Uses implemented schema (with agentType, not agentIdentity)
});

export class TaskExecutionCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_EXECUTION_COMPLETED;
  // ... fields from schema
}
```

Event name: `EVENT_NAMES.TASK_EXECUTION_COMPLETED = 'execution.task-execution-completed'`

**Note:** The event carries `modelProfile` because `AgentResult` only has `provider`/`modelId` but not which profile was selected. The orchestrator (future `ExecuteSliceUseCase`) knows the profile from settings resolution.

### MetricsRepositoryPort

```typescript
export abstract class MetricsRepositoryPort {
  abstract append(entry: TaskMetrics): Promise<Result<void, PersistenceError>>;
  abstract readBySlice(sliceId: string): Promise<Result<TaskMetrics[], PersistenceError>>;
  abstract readByMilestone(milestoneId: string): Promise<Result<TaskMetrics[], PersistenceError>>;
  abstract readAll(): Promise<Result<TaskMetrics[], PersistenceError>>;
}
```

### MetricsQueryPort (cross-hexagon, read-only)

```typescript
export abstract class MetricsQueryPort {
  abstract aggregateBySlice(sliceId: string): Promise<Result<AggregatedMetrics, PersistenceError>>;
  abstract aggregateByMilestone(milestoneId: string): Promise<Result<AggregatedMetrics, PersistenceError>>;
}
```

## Architecture

### File structure

```
src/hexagons/execution/
  domain/
    task-metrics.schemas.ts              # TaskMetricsSchema, AggregatedMetricsSchema
    task-metrics.schemas.spec.ts
    task-metrics.builder.ts              # Faker-based builder
    task-metrics.builder.spec.ts
    events/
      task-execution-completed.event.ts  # New event
      task-execution-completed.event.spec.ts
    ports/
      metrics-repository.port.ts         # Write + read
      metrics-query.port.ts              # Cross-hexagon read-only
  application/
    record-task-metrics.use-case.ts      # Event subscriber → persist
    record-task-metrics.use-case.spec.ts
    aggregate-metrics.use-case.ts        # Query + aggregation
    aggregate-metrics.use-case.spec.ts
  infrastructure/
    jsonl-metrics.repository.ts          # JSONL adapter (receives filePath via constructor)
    jsonl-metrics.repository.spec.ts
    in-memory-metrics.repository.ts      # Test double
    in-memory-metrics.repository.spec.ts
```

### Data flow (write path)

```
AgentDispatchPort.dispatch() → AgentResult
  ↓
Orchestrator publishes TaskExecutionCompletedEvent
  (carries: agentResult + modelProfile + sliceId + milestoneId)
  ↓ (EventBus subscription)
RecordTaskMetricsUseCase.onTaskExecutionCompleted(event)
  ↓
Builds TaskMetrics (see field mapping below)
  ↓
MetricsRepositoryPort.append(taskMetrics)
  ↓
.tff/metrics.jsonl (one JSON line appended)
```

**Note on event emission:** This slice implements the event definition, subscription, and persistence. The emission site is the future `ExecuteSliceUseCase` (S07). For testing within this slice, unit tests use a mock event bus to publish the event directly. AC1 verifies the event schema and subscription wiring, not the emission site.

**Dual event contract:** The orchestrator (S07) must emit both `TaskCompletedEvent` (task hexagon — lifecycle/status) and `TaskExecutionCompletedEvent` (execution hexagon — cost/results) after each dispatch. They serve different consumers: the journal handler subscribes to `TaskCompletedEvent`, the metrics collector subscribes to `TaskExecutionCompletedEvent`. Both are emitted at the same boundary, in that order.

### Field mapping: AgentResult → TaskMetrics

| TaskMetrics field | Source |
|---|---|
| `taskId` | `event.taskId` |
| `sliceId` | `event.sliceId` |
| `milestoneId` | `event.milestoneId` |
| `model.provider` | `event.agentResult.cost.provider` |
| `model.modelId` | `event.agentResult.cost.modelId` |
| `model.profile` | `event.modelProfile` (from orchestrator's settings resolution) |
| `tokens.input` | `event.agentResult.cost.inputTokens` |
| `tokens.output` | `event.agentResult.cost.outputTokens` |
| `costUsd` | `event.agentResult.cost.costUsd` |
| `durationMs` | `event.agentResult.durationMs` |
| `success` | `event.agentResult.success` |
| `retries` | `0` (default — retry tracking is Improvement B, future scope) |
| `downshifted` | `false` (default — downshift is Improvement B, future scope) |
| `reflectionPassed` | `undefined` (default — reflection is Improvement A, future scope) |
| `timestamp` | `event.props.occurredAt` |

### Data flow (query path)

```
AggregateMetricsUseCase.execute({ sliceId? milestoneId? })
  ↓
MetricsRepositoryPort.readBySlice() / readByMilestone()
  ↓
In-memory aggregation (sum tokens, cost, duration; group by model)
  ↓
AggregatedMetrics
```

## Error Handling

1. **Metrics write failure**: `RecordTaskMetricsUseCase.execute()` returns `Result<void, PersistenceError>`. When invoked as an event handler via `EventBus.subscribe()`, the return value is not examined (event bus catches and logs handler errors). The `Result` type is useful for direct callers and unit tests. The use case does its own `console.warn` on persistence failure.
2. **Corrupt JSONL line**: Reader uses `safeParse` per line; skips unparseable lines with warning. Valid entries still returned.
3. **Missing cost data**: If `AgentResult.cost` has zero tokens/cost (e.g., mock adapter), record entry with zeros. Don't filter.
4. **Empty metrics file**: `readAll`/`readBySlice` return empty array, not error.
5. **Concurrent appends**: Single-orchestrator model guarantees only one writer. No locking needed. (Note: POSIX `O_APPEND` + single `write()` is also atomic, but irrelevant here since there's only one writer.)
6. **AgentResult.cost is required**: The schema contract forces all agent adapters to produce cost data, even if zero. Mock/test adapters use zero values. This is by design — no special handling needed.
7. **File format divergence**: Design spec says `metrics.json`, this spec uses `metrics.jsonl` for append-safety. JSONL is strictly better for crash-safe writes.

## Acceptance Criteria

- [ ] AC1: `TaskExecutionCompletedEvent` emitted after every agent dispatch (success or failure), carrying the complete `AgentResult` as defined by `AgentResultSchema`
- [ ] AC2: `RecordTaskMetricsUseCase` transforms `AgentResult` into `TaskMetrics` and persists via `MetricsRepositoryPort`
- [ ] AC3: JSONL adapter appends one line per entry to `.tff/metrics.jsonl`, parseable on read
- [ ] AC4: `AggregateMetricsUseCase` returns per-slice totals (cost, tokens, duration, task count, success/failure)
- [ ] AC5: `AggregateMetricsUseCase` returns per-milestone totals with model breakdown
- [ ] AC6: In-memory adapter passes same contract tests as JSONL adapter
- [ ] AC7: Cross-hexagon `MetricsQueryPort` exported from execution barrel for future Intelligence consumption
- [ ] AC8: Event name constant added to kernel `EVENT_NAMES`

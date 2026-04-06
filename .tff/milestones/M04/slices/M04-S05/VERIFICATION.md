# M04-S05 Verification

Date: 2026-03-30

## AC1: TaskExecutionCompletedEvent emitted after every agent dispatch (success or failure), carrying the complete AgentResult as defined by AgentResultSchema

**Verdict: PASS**

Evidence:
- `task-execution-completed.event.ts` (L19): Props schema includes `agentResult: AgentResultSchema` -- the complete schema, not a subset.
- Event class exposes `readonly agentResult: AgentResult` (L31), preserving the full object including `cost`, `success`, `durationMs`, `agentType`.
- Event spec verifies construction with valid props and asserts `cost.inputTokens`, `cost.outputTokens`, `cost.costUsd`, and `success` are carried through (L38-44).
- `record-task-metrics.use-case.spec.ts` explicitly tests failure case: `withFailure("timeout")` produces an event with `success === false` (L68-91, test: "records failed dispatches too (AC1)").
- All 5 event tests pass; both use-case tests pass.

## AC2: RecordTaskMetricsUseCase transforms AgentResult into TaskMetrics and persists via MetricsRepositoryPort

**Verdict: PASS**

Evidence:
- `record-task-metrics.use-case.ts` (L18-38): Field mapping matches spec exactly:
  - `model.provider` <- `event.agentResult.cost.provider`
  - `model.modelId` <- `event.agentResult.cost.modelId`
  - `model.profile` <- `event.modelProfile`
  - `tokens.input` <- `event.agentResult.cost.inputTokens`
  - `tokens.output` <- `event.agentResult.cost.outputTokens`
  - `costUsd` <- `event.agentResult.cost.costUsd`
  - `durationMs` <- `event.agentResult.durationMs`
  - `success` <- `event.agentResult.success`
  - `retries: 0`, `downshifted: false`, `reflectionPassed: undefined` (defaults per spec)
  - `timestamp` <- `event.occurredAt`
- Use case subscribes via `eventBus.subscribe(EVENT_NAMES.TASK_EXECUTION_COMPLETED, ...)` (L10).
- Test "transforms AgentResult into TaskMetrics and persists (AC2)" verifies every field (L20-65).
- Persistence failure handled with `console.warn` (L42-43), matching spec error handling.
- All 2 tests pass.

## AC3: JSONL adapter appends one line per entry to .tff/metrics.jsonl, parseable on read

**Verdict: PASS**

Evidence:
- `jsonl-metrics.repository.ts`: `append()` uses `appendFile()` with `\n`-terminated JSON line (L31).
- `readAll()` splits on `\n`, parses each line with `TaskMetricsSchema.safeParse()`, skips corrupt lines (L46-58).
- JSONL-specific test "appends one JSON line per entry" writes 2 entries, reads file, confirms 2 parseable lines (L25-35).
- Test "skips corrupt lines and returns valid entries" injects a corrupt line between two valid entries, confirms 2 entries returned (L38-51).
- Test "returns empty array for non-existent file" confirms ENOENT returns `ok([])` (L53-58).
- Contract test "append + readAll round-trips (AC3)" passes for JSONL adapter.
- All 9 JSONL tests pass.

## AC4: AggregateMetricsUseCase returns per-slice totals (cost, tokens, duration, task count, success/failure)

**Verdict: PASS**

Evidence:
- `aggregate-metrics.use-case.ts`: `aggregateBySlice()` (L12-16) reads by slice, then calls `aggregate()` which computes `totalCostUsd`, `totalInputTokens`, `totalOutputTokens`, `totalDurationMs`, `taskCount`, `successCount`, `failureCount`, `averageCostPerTask`, `modelBreakdown`.
- Test "returns per-slice totals (AC4)" creates 3 entries (2 success, 1 failure), asserts:
  - `taskCount === 3`, `successCount === 2`, `failureCount === 1`
  - `totalInputTokens === 3500`, `totalOutputTokens === 1500`
  - `totalCostUsd ~= 0.15`, `totalDurationMs === 35000`
  - `averageCostPerTask ~= 0.05`
- Test "excludes entries from other slices" confirms filtering.
- All 4 aggregate tests pass.

## AC5: AggregateMetricsUseCase returns per-milestone totals with model breakdown

**Verdict: PASS**

Evidence:
- `aggregate-metrics.use-case.ts` (L39-51): Model breakdown groups by `entry.model.modelId`, accumulates `taskCount` and `totalCostUsd` per model.
- Test "returns per-milestone totals with model breakdown (AC5)" creates entries with 2 different models (`claude-sonnet-4-6` x2, `claude-opus-4-6` x1), asserts:
  - `modelBreakdown.length === 2`
  - Sonnet: `taskCount === 2`, `totalCostUsd ~= 0.13`
  - Opus: `taskCount === 1`, `totalCostUsd ~= 0.5`
- Test passes.

## AC6: In-memory adapter passes same contract tests as JSONL adapter

**Verdict: PASS**

Evidence:
- `metrics-repository.contract.spec.ts` exports `runMetricsContractTests()` with 6 tests: append+readAll round-trip, readBySlice filter, readByMilestone filter, empty readAll, empty readBySlice, field preservation.
- `in-memory-metrics.repository.spec.ts` (L4): `runMetricsContractTests("InMemoryMetricsRepository", () => new InMemoryMetricsRepository())`.
- `jsonl-metrics.repository.spec.ts` (L19-22): `runMetricsContractTests("JsonlMetricsRepository", () => new JsonlMetricsRepository(...))`.
- Both adapters implement `MetricsRepositoryPort` and expose `reset()`.
- InMemory: 6 contract tests pass. JSONL: 6 contract tests + 3 JSONL-specific tests pass.

## AC7: Cross-hexagon MetricsQueryPort exported from execution barrel for future Intelligence consumption

**Verdict: PASS**

Evidence:
- `metrics-query.port.ts`: Abstract class with `aggregateBySlice(sliceId: string)` and `aggregateByMilestone(milestoneId: string)`, both returning `Promise<Result<AggregatedMetrics, PersistenceError>>`.
- `index.ts` (L51): `export { MetricsQueryPort } from "./domain/ports/metrics-query.port"` -- exported from barrel.
- Port is read-only (no write methods), matching the cross-hexagon contract specified.

## AC8: Event name constant added to kernel EVENT_NAMES

**Verdict: PASS**

Evidence:
- `event-names.ts` (L18): `TASK_EXECUTION_COMPLETED: "execution.task-execution-completed"`.
- Value included in `EventNameSchema` z.enum (L38).
- Test "contains all 15 event names" passes (count updated from prior 14).
- Test "all values are unique" passes.
- Test "values follow domain.action format" passes.
- All 7 event-names tests pass.

## Summary

| AC | Verdict |
|----|---------|
| AC1 | PASS |
| AC2 | PASS |
| AC3 | PASS |
| AC4 | PASS |
| AC5 | PASS |
| AC6 | PASS |
| AC7 | PASS |
| AC8 | PASS |

All 8 acceptance criteria verified. All 33 tests pass across 6 test files.

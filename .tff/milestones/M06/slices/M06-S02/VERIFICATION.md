# S02: Agent Event Deepening — Verification Report

## Summary

**Overall Verdict: PASS** — 9/9 acceptance criteria met.

| AC | Criterion | Verdict |
|----|-----------|---------|
| AC1 | AgentEventPort in kernel with subscribe/emit/clear — typed for all 8 event kinds | PASS |
| AC2 | InMemoryAgentEventHub passes unit tests (subscribe, emit, clear, multi-listener, per-task isolation) | PASS |
| AC3 | PiAgentDispatchAdapter subscribes via `session.subscribe()` on per-task sessions — NOT host Extension API | PASS |
| AC4 | All 8 PI SDK core events mapped to domain AgentEvent types | PASS |
| AC5 | AgentResult.turns contains per-turn metrics (turn count, tool calls per turn, durations) | PASS |
| AC6 | TurnMetricsCollector accumulates events and produces TurnMetrics[] | PASS |
| AC7 | Journal entries include tool-execution and turn-boundary types with tool call details | PASS |
| AC8 | Existing execution tests pass — no domain logic regressions | PASS |
| AC9 | New tests: AgentEventPort contract, TurnMetricsCollector, adapter event wiring | PASS |

## Test Results

- **1623 tests pass, 0 failures**
- TypeScript: clean (no type errors)
- Lint: clean (only pre-existing issues)

## Evidence

### AC1 — AgentEventPort
- `src/kernel/ports/agent-event.port.ts`: abstract class with `subscribe(taskId, listener)`, `emit(taskId, event)`, `clear(taskId)`
- `src/kernel/agents/agent-event.schema.ts`: discriminated union of 8 types: `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- Exported from kernel barrels

### AC2 — InMemoryAgentEventHub
- `src/kernel/infrastructure/in-memory-agent-event-hub.ts`: extends `AgentEventPort`
- 8 unit tests: subscribe, multi-listener, per-task isolation, unsubscribe, clear, no-op edge cases

### AC3 — Session-level subscribe
- `pi-agent-dispatch.adapter.ts:152`: `session.subscribe((piEvent) => { ... })` — per-task session
- No Extension API references

### AC4 — Event mapping
- Switch statement maps all 8 PI SDK core events to domain events
- SDK-internal events (`compaction_*`, `auto_retry_*`, `queue_update`, `agent_start`, `agent_end`) explicitly skipped

### AC5 — AgentResult.turns
- `agent-result.schema.ts:30`: `turns: z.array(TurnMetricsSchema).default([])`
- TurnMetrics: `turnIndex`, `toolCalls[]`, `durationMs`
- Tests confirm default empty + populated parsing

### AC6 — TurnMetricsCollector
- `turn-metrics-collector.ts`: `record(event)` + `toMetrics()`, handles partial turns (`durationMs: 0`)
- 8 tests: empty, single turn, accumulation, multiple turns, partial, idempotent, ignores message/tool_start events

### AC7 — Journal entries
- `journal-entry.schemas.ts`: `ToolExecutionEntrySchema` (taskId, turnIndex, toolCallId, toolName, durationMs, isError) + `TurnBoundaryEntrySchema` (taskId, turnIndex, boundary, toolCallCount?)
- Both in `JournalEntrySchema` discriminated union

### AC8 — Regression
- Full suite: 1623 pass, 0 fail

### AC9 — New tests
- `agent-event.schema.spec.ts`: 14 tests
- `turn-metrics.schema.spec.ts`: 9 tests
- `in-memory-agent-event-hub.spec.ts`: 8 tests
- `turn-metrics-collector.spec.ts`: 8 tests

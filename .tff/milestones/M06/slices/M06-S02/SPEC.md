# S02: Agent Event Deepening

## Context

- **Milestone:** M06 — PI-Native Integration
- **Slice:** M06-S02
- **Wave:** 1 (parallel with S01, prerequisite for S03)
- **Complexity:** TBD (classified at end of discuss)

## Goal

Wire typed agent event streaming from PI SDK sessions into the TFF domain. Create an observable `AgentEventPort` in the kernel, adapt PI SDK `AgentSession.subscribe()` into domain events, enrich `AgentResult` with per-turn metrics, and extend the execution journal with tool call details.

## Scope

### In scope

- `AgentEventPort` abstract class in kernel — observable pattern (subscribe/emit/clear)
- `InMemoryAgentEventHub` kernel implementation
- `AgentEvent` discriminated union — 8 event types decoupled from PI SDK
- `TurnMetrics` + `ToolCallMetrics` schemas in kernel
- `AgentResult.turns` field for per-turn metric data
- `TurnMetricsCollector` stateful helper in execution domain
- PI SDK `session.subscribe()` wiring in `PiAgentDispatchAdapter`
- Event mapping: PI SDK `AgentSessionEvent` → domain `AgentEvent`
- New journal entry types: `tool-execution`, `turn-boundary`
- Contract tests for AgentEventPort, unit tests for collector and adapter wiring

### Out of scope

- Migration from `createAgentSession()` to raw `Agent` class (R02 non-goal)
- TUI overlay consumption of agent events (S04-S06)
- Domain EventBus publishing of agent events (not needed until TUI subscribes)
- Per-turn token/cost breakdown (PI SDK `getSessionStats()` is aggregate-only)
- `message_update` streaming to UI (S06 concern)
- Throttling or backpressure (consumers handle this; hub is sync)

## Design

### 1. AgentEvent Domain Types

New file: `src/kernel/agents/agent-event.schema.ts`

Zod-first discriminated union — 8 event types. All events carry `taskId`, `turnIndex`, and `timestamp`.

```typescript
// Turn lifecycle
AgentTurnStart     { type: "turn_start",     taskId, turnIndex, timestamp }
AgentTurnEnd       { type: "turn_end",       taskId, turnIndex, toolCallCount, timestamp }

// Message lifecycle (within a turn)
AgentMessageStart  { type: "message_start",  taskId, turnIndex, timestamp }
AgentMessageUpdate { type: "message_update", taskId, turnIndex, textDelta, timestamp }
AgentMessageEnd    { type: "message_end",    taskId, turnIndex, timestamp }

// Tool execution lifecycle (within a turn)
AgentToolExecutionStart  { type: "tool_execution_start",  taskId, turnIndex, toolCallId, toolName, timestamp }
AgentToolExecutionUpdate { type: "tool_execution_update", taskId, turnIndex, toolCallId, toolName, timestamp }
AgentToolExecutionEnd    { type: "tool_execution_end",    taskId, turnIndex, toolCallId, toolName, isError, durationMs, timestamp }
```

Key decisions:
- `turnIndex` on every event — adapter tracks turn count, stamps it. Enables per-turn grouping without stateful consumers.
- `textDelta` on message_update — incremental text only, not full content.
- `durationMs` on tool_execution_end — adapter computes from start/end timestamps.
- No `args`/`result` on tool events — can be large. Journal entries optionally capture them but domain events stay lean.
- Deliberately decoupled from PI SDK types — no `AgentMessage` references, no `partialResult`.

### 2. AgentEventPort Interface

New file: `src/kernel/ports/agent-event.port.ts`

```typescript
export type AgentEventListener = (event: AgentEvent) => void;
export type Unsubscribe = () => void;

export abstract class AgentEventPort {
  abstract subscribe(taskId: string, listener: AgentEventListener): Unsubscribe;
  abstract emit(taskId: string, event: AgentEvent): void;
  abstract clear(taskId: string): void;
}
```

- Scoped by `taskId` — listeners only receive events for subscribed tasks.
- `clear(taskId)` — prevents memory leaks, called after task completion.
- Sync `emit()` — intentional for high-frequency events. No async publish overhead. Consumers that need async work buffer internally.
- Exported from kernel barrel.

### 3. InMemoryAgentEventHub

New file: `src/kernel/infrastructure/in-memory-agent-event-hub.ts`

```typescript
export class InMemoryAgentEventHub extends AgentEventPort {
  private listeners = new Map<string, Set<AgentEventListener>>();

  subscribe(taskId, listener): Unsubscribe {
    const set = this.listeners.get(taskId) ?? new Set();
    set.add(listener);
    this.listeners.set(taskId, set);
    return () => { set.delete(listener); };
  }

  emit(taskId, event): void {
    const set = this.listeners.get(taskId);
    if (!set) return;
    for (const listener of set) listener(event);
  }

  clear(taskId): void {
    this.listeners.delete(taskId);
  }
}
```

In-process, no PI SDK dependency. Lives in kernel infrastructure alongside `InProcessEventBus`.

### 4. PI SDK Event Wiring (PiAgentDispatchAdapter)

Modified file: `src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts`

New dependency: `AgentEventPort`. Added to constructor deps.

Between session creation and `session.prompt()`:

```typescript
let turnIndex = -1;
let toolCallsInTurn = 0;
const toolStartTimes = new Map<string, number>();

const unsubscribe = session.subscribe((piEvent) => {
  const now = Date.now();
  switch (piEvent.type) {
    case "turn_start":
      turnIndex++;
      agentEventPort.emit(taskId, { type: "turn_start", taskId, turnIndex, timestamp: now });
      break;
    case "turn_end":
      agentEventPort.emit(taskId, {
        type: "turn_end", taskId, turnIndex,
        toolCallCount: toolCallsInTurn, timestamp: now,
      });
      toolCallsInTurn = 0;
      break;
    case "message_start":
    case "message_end":
      agentEventPort.emit(taskId, { type: piEvent.type, taskId, turnIndex, timestamp: now });
      break;
    case "message_update":
      const delta = extractTextDelta(piEvent.assistantMessageEvent);
      if (delta) agentEventPort.emit(taskId, { type: "message_update", taskId, turnIndex, textDelta: delta, timestamp: now });
      break;
    case "tool_execution_start":
      toolCallsInTurn++;
      toolStartTimes.set(piEvent.toolCallId, now);
      agentEventPort.emit(taskId, { type: "tool_execution_start", taskId, turnIndex, toolCallId: piEvent.toolCallId, toolName: piEvent.toolName, timestamp: now });
      break;
    case "tool_execution_update":
      agentEventPort.emit(taskId, { type: "tool_execution_update", taskId, turnIndex, toolCallId: piEvent.toolCallId, toolName: piEvent.toolName, timestamp: now });
      break;
    case "tool_execution_end":
      const startTime = toolStartTimes.get(piEvent.toolCallId) ?? now;
      agentEventPort.emit(taskId, { type: "tool_execution_end", taskId, turnIndex, toolCallId: piEvent.toolCallId, toolName: piEvent.toolName, isError: piEvent.isError, durationMs: now - startTime, timestamp: now });
      toolStartTimes.delete(piEvent.toolCallId);
      break;
    // Skip: agent_start, agent_end, compaction_*, auto_retry_*, queue_update
  }
});

const result = await session.prompt(prompt);
unsubscribe();
agentEventPort.clear(taskId);
```

- `turnIndex` tracked locally per dispatch call.
- `extractTextDelta` — helper that discriminates on `assistantMessageEvent.type === "text_delta"` and returns `.delta` string. `AssistantMessageEvent` is a discriminated union (`start`, `text_start`, `text_delta`, `text_end`, `thinking_*`, `toolcall_*`, `done`, `error`); only `text_delta` carries extractable text. Exact field names TBD in research.
- SDK-internal events (`compaction_*`, `auto_retry_*`, `queue_update`) ignored.
- `agent_start`/`agent_end` intentionally skipped — `agent_end.messages` could be useful for post-execution analysis but is not needed for event streaming. Revisit in research.
- Deterministic cleanup: unsubscribe + clear after prompt returns.

### 5. TurnMetrics + AgentResult Enrichment

New file: `src/kernel/agents/turn-metrics.schema.ts`

```typescript
const ToolCallMetricsSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  durationMs: z.number().int().nonnegative(),
  isError: z.boolean(),
});

const TurnMetricsSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  toolCalls: z.array(ToolCallMetricsSchema).default([]),
  durationMs: z.number().int().nonnegative(),
});
```

Modified file: `src/kernel/agents/agent-result.schema.ts` — add field:

```typescript
turns: z.array(TurnMetricsSchema).default([]),
```

New file: `src/hexagons/execution/domain/turn-metrics-collector.ts`

Stateful helper that subscribes to AgentEventPort and accumulates events into `TurnMetrics[]`.

Behavior:
- On `turn_start`: push new turn entry, record start timestamp from event.
- On `tool_execution_end`: append to current turn's `toolCalls` array.
- On `turn_end`: compute `durationMs` as `turn_end.timestamp - turn_start.timestamp` (both from emitted domain events, so same clock source — the adapter's `Date.now()`).
- If `turn_end` never arrives (session abort): `toMetrics()` includes the partial turn with `durationMs: 0` and whatever tool calls were recorded. Consumers check `durationMs === 0` to detect incomplete turns.
- `toMetrics()` is idempotent — returns a snapshot, does not reset state. Safe to call multiple times.

**Owner:** The `PiAgentDispatchAdapter` creates the collector, subscribes it, and injects `collector.toMetrics()` into the returned `AgentResult.turns` after `session.prompt()` resolves. This keeps the wiring co-located with the session lifecycle.

```typescript
// In PiAgentDispatchAdapter.dispatch(), before session.prompt():
const collector = new TurnMetricsCollector();
const unsubCollector = agentEventPort.subscribe(taskId, (e) => collector.record(e));

// After session.prompt():
unsubCollector();
const result: AgentResult = { ...rawResult, turns: collector.toMetrics() };
```

### 6. Journal Entry Enrichment

Modified file: `src/hexagons/execution/domain/journal-entry.schemas.ts`

Two new entry types added to the discriminated union. Both extend `JournalEntryBaseSchema` (which provides `seq`, `sliceId`, `timestamp`, `correlationId`) — consistent with all existing journal entry types:

```typescript
const ToolExecutionEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("tool-execution"),
  taskId: IdSchema,
  turnIndex: z.number().int().nonnegative(),
  toolCallId: z.string(),
  toolName: z.string(),
  durationMs: z.number().int().nonnegative(),
  isError: z.boolean(),
});

const TurnBoundaryEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("turn-boundary"),
  taskId: IdSchema,
  turnIndex: z.number().int().nonnegative(),
  boundary: z.enum(["start", "end"]),
  toolCallCount: z.number().int().nonnegative().optional(), // only on "end"
});
```

Only `turn_start`, `turn_end`, and `tool_execution_end` are journaled. `message_*` and `tool_execution_update` are too high-frequency for audit log.

**Who writes journal entries:** The `PiAgentDispatchAdapter` owns the subscription and event mapping. It also writes journal entries for the 3 journaled event types (`turn_start`, `turn_end`, `tool_execution_end`) by calling `JournalRepositoryPort.append()` directly. This keeps journal writing co-located with event production — the adapter already has access to the journal repository via execution context. The adapter does NOT write `message_*` or `tool_execution_update` to the journal.

## File Impact

| File | Action |
|------|--------|
| `src/kernel/agents/agent-event.schema.ts` | **New** — AgentEvent discriminated union |
| `src/kernel/agents/turn-metrics.schema.ts` | **New** — TurnMetrics + ToolCallMetrics |
| `src/kernel/agents/agent-result.schema.ts` | **Modify** — add `turns` field |
| `src/kernel/ports/agent-event.port.ts` | **New** — AgentEventPort abstract class |
| `src/kernel/infrastructure/in-memory-agent-event-hub.ts` | **New** — InMemoryAgentEventHub |
| `src/kernel/ports/index.ts` (or barrel) | **Modify** — export AgentEventPort |
| `src/hexagons/execution/domain/journal-entry.schemas.ts` | **Modify** — add 2 entry types |
| `src/hexagons/execution/domain/turn-metrics-collector.ts` | **New** — stateful collector |
| `src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts` | **Modify** — session.subscribe() wiring |
| `src/hexagons/execution/infrastructure/agent-dispatch.contract.spec.ts` | **Modify** — event emission contracts |
| Bootstrap/DI wiring | **Modify** — inject InMemoryAgentEventHub |

**New files:** 5 | **Modified files:** 5-6

## Acceptance Criteria

1. AgentEventPort in kernel with subscribe/emit/clear — typed for all 8 event kinds
2. InMemoryAgentEventHub passes unit tests (subscribe, emit, clear, multi-listener, per-task isolation)
3. PiAgentDispatchAdapter subscribes via `session.subscribe()` on per-task sessions — NOT host Extension API
4. All 8 PI SDK core events mapped to domain AgentEvent types
5. AgentResult.turns contains per-turn metrics (turn count, tool calls per turn, durations)
6. TurnMetricsCollector accumulates events and produces TurnMetrics[]
7. Journal entries include tool-execution and turn-boundary types with tool call details
8. Existing execution tests pass — no domain logic regressions
9. New tests: AgentEventPort contract, TurnMetricsCollector, adapter event wiring

## Risks

| Risk | Mitigation |
|------|------------|
| `AssistantMessageEvent` shape unknown — `extractTextDelta` must discriminate on `.type === "text_delta"` | Research phase: inspect PI SDK types for exact `AssistantMessageEvent` union variants and field names |
| `session.subscribe()` listener fires after `session.prompt()` resolves (race) | Unsubscribe after prompt; clear() for cleanup. Test with delayed events |
| High-frequency `message_update` floods hub | Listeners opt-in per task; TUI throttling is S06 concern. Hub is sync — no queue buildup |
| Session abort mid-turn — `turn_end` never fires | Collector handles partial turns (durationMs: 0). Adapter cleanup still runs (unsubscribe + clear in finally block) |
| Real `AgentSession.subscribe` may use different method name | Research: verify exact API in node_modules |

## Notes

- R02 says `AgentSession.on()` but the actual PI SDK API is `session.subscribe()`. This spec uses the correct API.
- R02 names a `PiSessionEventAdapter` class. This design wires event subscription inline in `PiAgentDispatchAdapter.dispatch()` instead — simpler, no separate class needed. The adapter IS the session event adapter.

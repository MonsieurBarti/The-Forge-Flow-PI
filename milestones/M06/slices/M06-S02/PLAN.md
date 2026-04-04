# S02: Agent Event Deepening — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Wire typed agent event streaming from PI SDK sessions into the TFF domain. Create an observable `AgentEventPort` in the kernel, adapt PI SDK `session.subscribe()` into domain events, enrich `AgentResult` with per-turn metrics, and extend the execution journal with tool call details.

**Architecture:** Hexagonal — new port in kernel, implementation in kernel infrastructure, adapter wiring in execution infrastructure. All new types are Zod-first schemas.

**Tech Stack:** TypeScript, Zod, Vitest

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/kernel/agents/agent-event.schema.ts` | AgentEvent discriminated union — 8 event types |
| `src/kernel/agents/turn-metrics.schema.ts` | TurnMetrics + ToolCallMetrics Zod schemas |
| `src/kernel/ports/agent-event.port.ts` | AgentEventPort abstract class (subscribe/emit/clear) |
| `src/kernel/infrastructure/in-memory-agent-event-hub.ts` | InMemoryAgentEventHub — in-process implementation |
| `src/hexagons/execution/domain/turn-metrics-collector.ts` | Stateful collector: AgentEvent → TurnMetrics[] |

### New Test Files
| File | Tests |
|------|-------|
| `src/kernel/agents/agent-event.schema.spec.ts` | Schema validation for all 8 event types |
| `src/kernel/agents/turn-metrics.schema.spec.ts` | Schema validation for TurnMetrics + ToolCallMetrics |
| `src/kernel/infrastructure/in-memory-agent-event-hub.spec.ts` | Hub: subscribe, emit, clear, multi-listener, per-task isolation |
| `src/hexagons/execution/domain/turn-metrics-collector.spec.ts` | Collector: accumulation, toMetrics(), partial turns |

### Modified Files
| File | Change |
|------|--------|
| `src/kernel/agents/agent-result.schema.ts` | Add `turns` field (TurnMetricsSchema[]) |
| `src/kernel/agents/agent-result.builder.ts` | Add `withTurns()` method |
| `src/kernel/agents/index.ts` | Export new schemas + types |
| `src/kernel/ports/index.ts` | Export AgentEventPort |
| `src/kernel/infrastructure/index.ts` | Export InMemoryAgentEventHub |
| `src/kernel/index.ts` | Re-export from new modules |
| `src/hexagons/execution/domain/journal-entry.schemas.ts` | Add tool-execution + turn-boundary entry types |
| `src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts` | session.subscribe() wiring, metrics collector, journal writes |

### Modified Test Files
| File | Change |
|------|--------|
| `src/kernel/agents/agent-result.schema.spec.ts` | Test turns field defaults + parsing |
| `src/kernel/agents/agent-result.builder.spec.ts` | Test withTurns() |
| `src/hexagons/execution/domain/journal-entry.schemas.spec.ts` | Test tool-execution + turn-boundary schemas |

---

## Wave 0 (parallel — no dependencies)

### T01: AgentEvent Domain Types
**Files:** Create `src/kernel/agents/agent-event.schema.ts`, Create `src/kernel/agents/agent-event.schema.spec.ts`, Modify `src/kernel/agents/index.ts`
**Traces to:** AC1, AC4

- [ ] Step 1: Write failing test

**File:** `src/kernel/agents/agent-event.schema.spec.ts`

```typescript
import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  AgentMessageEndSchema,
  AgentMessageStartSchema,
  AgentMessageUpdateSchema,
  AgentToolExecutionEndSchema,
  AgentToolExecutionStartSchema,
  AgentToolExecutionUpdateSchema,
  AgentTurnEndSchema,
  AgentTurnStartSchema,
} from "./agent-event.schema";

const TASK_ID = crypto.randomUUID();
const NOW = Date.now();

const base = { taskId: TASK_ID, turnIndex: 0, timestamp: NOW };

describe("AgentTurnStartSchema", () => {
  it("parses valid turn_start", () => {
    const result = AgentTurnStartSchema.parse({ ...base, type: "turn_start" });
    expect(result.type).toBe("turn_start");
    expect(result.taskId).toBe(TASK_ID);
  });

  it("rejects negative turnIndex", () => {
    expect(() =>
      AgentTurnStartSchema.parse({ ...base, type: "turn_start", turnIndex: -1 }),
    ).toThrow();
  });
});

describe("AgentTurnEndSchema", () => {
  it("parses valid turn_end with toolCallCount", () => {
    const result = AgentTurnEndSchema.parse({ ...base, type: "turn_end", toolCallCount: 3 });
    expect(result.toolCallCount).toBe(3);
  });

  it("rejects missing toolCallCount", () => {
    expect(() => AgentTurnEndSchema.parse({ ...base, type: "turn_end" })).toThrow();
  });
});

describe("AgentMessageStartSchema", () => {
  it("parses valid message_start", () => {
    const result = AgentMessageStartSchema.parse({ ...base, type: "message_start" });
    expect(result.type).toBe("message_start");
  });
});

describe("AgentMessageUpdateSchema", () => {
  it("parses valid message_update with textDelta", () => {
    const result = AgentMessageUpdateSchema.parse({
      ...base,
      type: "message_update",
      textDelta: "Hello",
    });
    expect(result.textDelta).toBe("Hello");
  });

  it("accepts empty string textDelta", () => {
    const result = AgentMessageUpdateSchema.parse({
      ...base,
      type: "message_update",
      textDelta: "",
    });
    expect(result.textDelta).toBe("");
  });

  it("rejects missing textDelta", () => {
    expect(() => AgentMessageUpdateSchema.parse({ ...base, type: "message_update" })).toThrow();
  });
});

describe("AgentMessageEndSchema", () => {
  it("parses valid message_end", () => {
    const result = AgentMessageEndSchema.parse({ ...base, type: "message_end" });
    expect(result.type).toBe("message_end");
  });
});

describe("AgentToolExecutionStartSchema", () => {
  it("parses valid tool_execution_start", () => {
    const result = AgentToolExecutionStartSchema.parse({
      ...base,
      type: "tool_execution_start",
      toolCallId: "tc_001",
      toolName: "Read",
    });
    expect(result.toolName).toBe("Read");
  });

  it("rejects empty toolCallId", () => {
    expect(() =>
      AgentToolExecutionStartSchema.parse({
        ...base,
        type: "tool_execution_start",
        toolCallId: "",
        toolName: "Read",
      }),
    ).toThrow();
  });
});

describe("AgentToolExecutionUpdateSchema", () => {
  it("parses valid tool_execution_update", () => {
    const result = AgentToolExecutionUpdateSchema.parse({
      ...base,
      type: "tool_execution_update",
      toolCallId: "tc_001",
      toolName: "Read",
    });
    expect(result.type).toBe("tool_execution_update");
  });
});

describe("AgentToolExecutionEndSchema", () => {
  it("parses valid tool_execution_end", () => {
    const result = AgentToolExecutionEndSchema.parse({
      ...base,
      type: "tool_execution_end",
      toolCallId: "tc_001",
      toolName: "Read",
      isError: false,
      durationMs: 150,
    });
    expect(result.durationMs).toBe(150);
    expect(result.isError).toBe(false);
  });

  it("rejects negative durationMs", () => {
    expect(() =>
      AgentToolExecutionEndSchema.parse({
        ...base,
        type: "tool_execution_end",
        toolCallId: "tc_001",
        toolName: "Read",
        isError: false,
        durationMs: -1,
      }),
    ).toThrow();
  });
});

describe("AgentEventSchema (discriminated union)", () => {
  it("routes turn_start correctly", () => {
    const event = AgentEventSchema.parse({ ...base, type: "turn_start" });
    expect(event.type).toBe("turn_start");
  });

  it("routes tool_execution_end correctly", () => {
    const event = AgentEventSchema.parse({
      ...base,
      type: "tool_execution_end",
      toolCallId: "tc_001",
      toolName: "Bash",
      isError: true,
      durationMs: 500,
    });
    expect(event.type).toBe("tool_execution_end");
  });

  it("routes message_update correctly", () => {
    const event = AgentEventSchema.parse({
      ...base,
      type: "message_update",
      textDelta: "chunk",
    });
    expect(event.type).toBe("message_update");
  });

  it("rejects unknown type", () => {
    expect(() => AgentEventSchema.parse({ ...base, type: "unknown_event" })).toThrow();
  });

  it("rejects invalid taskId", () => {
    expect(() =>
      AgentEventSchema.parse({
        taskId: "not-uuid",
        turnIndex: 0,
        timestamp: NOW,
        type: "turn_start",
      }),
    ).toThrow();
  });
});
```

- [ ] Step 2: Run test, verify FAIL

**Run:** `npx vitest run src/kernel/agents/agent-event.schema.spec.ts`
**Expect:** FAIL — Cannot find module `./agent-event.schema`

- [ ] Step 3: Implement AgentEvent schema

**File:** `src/kernel/agents/agent-event.schema.ts`

```typescript
import { IdSchema } from "@kernel/schemas";
import { z } from "zod";

const AgentEventBaseSchema = z.object({
  taskId: IdSchema,
  turnIndex: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
});

export const AgentTurnStartSchema = AgentEventBaseSchema.extend({
  type: z.literal("turn_start"),
});
export type AgentTurnStart = z.infer<typeof AgentTurnStartSchema>;

export const AgentTurnEndSchema = AgentEventBaseSchema.extend({
  type: z.literal("turn_end"),
  toolCallCount: z.number().int().nonnegative(),
});
export type AgentTurnEnd = z.infer<typeof AgentTurnEndSchema>;

export const AgentMessageStartSchema = AgentEventBaseSchema.extend({
  type: z.literal("message_start"),
});
export type AgentMessageStart = z.infer<typeof AgentMessageStartSchema>;

export const AgentMessageUpdateSchema = AgentEventBaseSchema.extend({
  type: z.literal("message_update"),
  textDelta: z.string(),
});
export type AgentMessageUpdate = z.infer<typeof AgentMessageUpdateSchema>;

export const AgentMessageEndSchema = AgentEventBaseSchema.extend({
  type: z.literal("message_end"),
});
export type AgentMessageEnd = z.infer<typeof AgentMessageEndSchema>;

export const AgentToolExecutionStartSchema = AgentEventBaseSchema.extend({
  type: z.literal("tool_execution_start"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
});
export type AgentToolExecutionStart = z.infer<typeof AgentToolExecutionStartSchema>;

export const AgentToolExecutionUpdateSchema = AgentEventBaseSchema.extend({
  type: z.literal("tool_execution_update"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
});
export type AgentToolExecutionUpdate = z.infer<typeof AgentToolExecutionUpdateSchema>;

export const AgentToolExecutionEndSchema = AgentEventBaseSchema.extend({
  type: z.literal("tool_execution_end"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  isError: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});
export type AgentToolExecutionEnd = z.infer<typeof AgentToolExecutionEndSchema>;

export const AgentEventSchema = z.discriminatedUnion("type", [
  AgentTurnStartSchema,
  AgentTurnEndSchema,
  AgentMessageStartSchema,
  AgentMessageUpdateSchema,
  AgentMessageEndSchema,
  AgentToolExecutionStartSchema,
  AgentToolExecutionUpdateSchema,
  AgentToolExecutionEndSchema,
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
```

- [ ] Step 4: Add barrel exports

**File:** `src/kernel/agents/index.ts` — append after existing exports:

```typescript
// Agent event streaming
export type {
  AgentEvent,
  AgentMessageEnd,
  AgentMessageStart,
  AgentMessageUpdate,
  AgentToolExecutionEnd,
  AgentToolExecutionStart,
  AgentToolExecutionUpdate,
  AgentTurnEnd,
  AgentTurnStart,
} from "./agent-event.schema";
export {
  AgentEventSchema,
  AgentMessageEndSchema,
  AgentMessageStartSchema,
  AgentMessageUpdateSchema,
  AgentToolExecutionEndSchema,
  AgentToolExecutionStartSchema,
  AgentToolExecutionUpdateSchema,
  AgentTurnEndSchema,
  AgentTurnStartSchema,
} from "./agent-event.schema";
```

- [ ] Step 5: Update kernel barrel

**File:** `src/kernel/index.ts` — add to the type exports from `"./agents"`:

```typescript
  AgentEvent,
  AgentTurnStart,
  AgentTurnEnd,
  AgentMessageStart,
  AgentMessageUpdate,
  AgentMessageEnd,
  AgentToolExecutionStart,
  AgentToolExecutionUpdate,
  AgentToolExecutionEnd,
```

Add to the value exports from `"./agents"`:

```typescript
  AgentEventSchema,
  AgentTurnStartSchema,
  AgentTurnEndSchema,
  AgentMessageStartSchema,
  AgentMessageUpdateSchema,
  AgentMessageEndSchema,
  AgentToolExecutionStartSchema,
  AgentToolExecutionUpdateSchema,
  AgentToolExecutionEndSchema,
```

- [ ] Step 6: Run test, verify PASS

**Run:** `npx vitest run src/kernel/agents/agent-event.schema.spec.ts`
**Expect:** PASS — all tests green

- [ ] Step 7: Commit

**Run:** `git add src/kernel/agents/agent-event.schema.ts src/kernel/agents/agent-event.schema.spec.ts src/kernel/agents/index.ts src/kernel/index.ts && git commit -m "feat(S02/T01): add AgentEvent discriminated union schema"`

---

### T02: TurnMetrics + ToolCallMetrics Schemas
**Files:** Create `src/kernel/agents/turn-metrics.schema.ts`, Create `src/kernel/agents/turn-metrics.schema.spec.ts`, Modify `src/kernel/agents/index.ts`
**Traces to:** AC5

- [ ] Step 1: Write failing test

**File:** `src/kernel/agents/turn-metrics.schema.spec.ts`

```typescript
import { describe, expect, it } from "vitest";
import { ToolCallMetricsSchema, TurnMetricsSchema } from "./turn-metrics.schema";

describe("ToolCallMetricsSchema", () => {
  it("parses valid tool call metrics", () => {
    const result = ToolCallMetricsSchema.parse({
      toolCallId: "tc_001",
      toolName: "Read",
      durationMs: 150,
      isError: false,
    });
    expect(result.toolName).toBe("Read");
    expect(result.durationMs).toBe(150);
  });

  it("rejects negative durationMs", () => {
    expect(() =>
      ToolCallMetricsSchema.parse({
        toolCallId: "tc_001",
        toolName: "Read",
        durationMs: -1,
        isError: false,
      }),
    ).toThrow();
  });

  it("rejects non-integer durationMs", () => {
    expect(() =>
      ToolCallMetricsSchema.parse({
        toolCallId: "tc_001",
        toolName: "Read",
        durationMs: 1.5,
        isError: false,
      }),
    ).toThrow();
  });

  it("rejects empty toolCallId", () => {
    expect(() =>
      ToolCallMetricsSchema.parse({
        toolCallId: "",
        toolName: "Read",
        durationMs: 100,
        isError: false,
      }),
    ).toThrow();
  });
});

describe("TurnMetricsSchema", () => {
  it("parses valid turn metrics with tool calls", () => {
    const result = TurnMetricsSchema.parse({
      turnIndex: 0,
      toolCalls: [
        { toolCallId: "tc_001", toolName: "Read", durationMs: 50, isError: false },
      ],
      durationMs: 3000,
    });
    expect(result.turnIndex).toBe(0);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.durationMs).toBe(3000);
  });

  it("defaults toolCalls to empty array", () => {
    const result = TurnMetricsSchema.parse({ turnIndex: 1, durationMs: 1000 });
    expect(result.toolCalls).toEqual([]);
  });

  it("rejects negative turnIndex", () => {
    expect(() => TurnMetricsSchema.parse({ turnIndex: -1, durationMs: 100 })).toThrow();
  });

  it("rejects non-integer turnIndex", () => {
    expect(() => TurnMetricsSchema.parse({ turnIndex: 0.5, durationMs: 100 })).toThrow();
  });

  it("accepts turnIndex = 0", () => {
    const result = TurnMetricsSchema.parse({ turnIndex: 0, durationMs: 100 });
    expect(result.turnIndex).toBe(0);
  });

  it("accepts durationMs = 0 (partial turn)", () => {
    const result = TurnMetricsSchema.parse({ turnIndex: 0, durationMs: 0 });
    expect(result.durationMs).toBe(0);
  });
});
```

- [ ] Step 2: Run test, verify FAIL

**Run:** `npx vitest run src/kernel/agents/turn-metrics.schema.spec.ts`
**Expect:** FAIL — Cannot find module `./turn-metrics.schema`

- [ ] Step 3: Implement TurnMetrics schema

**File:** `src/kernel/agents/turn-metrics.schema.ts`

```typescript
import { z } from "zod";

export const ToolCallMetricsSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  isError: z.boolean(),
});
export type ToolCallMetrics = z.infer<typeof ToolCallMetricsSchema>;

export const TurnMetricsSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  toolCalls: z.array(ToolCallMetricsSchema).default([]),
  durationMs: z.number().int().nonnegative(),
});
export type TurnMetrics = z.infer<typeof TurnMetricsSchema>;
```

- [ ] Step 4: Add barrel exports

**File:** `src/kernel/agents/index.ts` — append:

```typescript
// Turn metrics
export type { ToolCallMetrics, TurnMetrics } from "./turn-metrics.schema";
export { ToolCallMetricsSchema, TurnMetricsSchema } from "./turn-metrics.schema";
```

- [ ] Step 5: Update kernel barrel

**File:** `src/kernel/index.ts` — add to the type exports from `"./agents"`:

```typescript
  ToolCallMetrics,
  TurnMetrics,
```

Add to the value exports from `"./agents"`:

```typescript
  ToolCallMetricsSchema,
  TurnMetricsSchema,
```

- [ ] Step 6: Run test, verify PASS

**Run:** `npx vitest run src/kernel/agents/turn-metrics.schema.spec.ts`
**Expect:** PASS — all tests green

- [ ] Step 7: Commit

**Run:** `git add src/kernel/agents/turn-metrics.schema.ts src/kernel/agents/turn-metrics.schema.spec.ts src/kernel/agents/index.ts src/kernel/index.ts && git commit -m "feat(S02/T02): add TurnMetrics and ToolCallMetrics schemas"`

---

### T03: Journal Entry Enrichment
**Files:** Modify `src/hexagons/execution/domain/journal-entry.schemas.ts`, Modify `src/hexagons/execution/domain/journal-entry.schemas.spec.ts`
**Traces to:** AC7

- [ ] Step 1: Write failing tests

**File:** `src/hexagons/execution/domain/journal-entry.schemas.spec.ts`

Add `ToolExecutionEntrySchema` and `TurnBoundaryEntrySchema` to the import block at line 3.

Append before the end of the file:

```typescript
// ---------------------------------------------------------------------------
// ToolExecutionEntrySchema
// ---------------------------------------------------------------------------
describe("ToolExecutionEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "tool-execution" as const,
    taskId: crypto.randomUUID(),
    turnIndex: 0,
    toolCallId: "tc_001",
    toolName: "Read",
    durationMs: 150,
    isError: false,
  };

  it("parses a valid tool-execution entry", () => {
    const result = ToolExecutionEntrySchema.parse(valid);
    expect(result.type).toBe("tool-execution");
    expect(result.toolName).toBe("Read");
    expect(result.durationMs).toBe(150);
  });

  it("rejects empty toolName", () => {
    expect(() => ToolExecutionEntrySchema.parse({ ...valid, toolName: "" })).toThrow();
  });

  it("rejects negative durationMs", () => {
    expect(() => ToolExecutionEntrySchema.parse({ ...valid, durationMs: -1 })).toThrow();
  });

  it("rejects negative turnIndex", () => {
    expect(() => ToolExecutionEntrySchema.parse({ ...valid, turnIndex: -1 })).toThrow();
  });

  it("rejects missing toolCallId", () => {
    const { toolCallId: _, ...noId } = valid;
    expect(() => ToolExecutionEntrySchema.parse(noId)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TurnBoundaryEntrySchema
// ---------------------------------------------------------------------------
describe("TurnBoundaryEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "turn-boundary" as const,
    taskId: crypto.randomUUID(),
    turnIndex: 0,
    boundary: "start" as const,
  };

  it("parses a valid turn-boundary start entry", () => {
    const result = TurnBoundaryEntrySchema.parse(valid);
    expect(result.type).toBe("turn-boundary");
    expect(result.boundary).toBe("start");
    expect(result.toolCallCount).toBeUndefined();
  });

  it("parses turn-boundary end with toolCallCount", () => {
    const result = TurnBoundaryEntrySchema.parse({
      ...valid,
      boundary: "end",
      toolCallCount: 3,
    });
    expect(result.boundary).toBe("end");
    expect(result.toolCallCount).toBe(3);
  });

  it("rejects invalid boundary value", () => {
    expect(() => TurnBoundaryEntrySchema.parse({ ...valid, boundary: "middle" })).toThrow();
  });

  it("rejects negative turnIndex", () => {
    expect(() => TurnBoundaryEntrySchema.parse({ ...valid, turnIndex: -1 })).toThrow();
  });
});
```

Add to the existing `JournalEntrySchema` describe block:

```typescript
  it("routes tool-execution correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "tool-execution",
      taskId: crypto.randomUUID(),
      turnIndex: 0,
      toolCallId: "tc_001",
      toolName: "Bash",
      durationMs: 200,
      isError: false,
    });
    expect(entry.type).toBe("tool-execution");
  });

  it("routes turn-boundary correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "turn-boundary",
      taskId: crypto.randomUUID(),
      turnIndex: 1,
      boundary: "end",
      toolCallCount: 2,
    });
    expect(entry.type).toBe("turn-boundary");
  });
```

- [ ] Step 2: Run test, verify FAIL

**Run:** `npx vitest run src/hexagons/execution/domain/journal-entry.schemas.spec.ts`
**Expect:** FAIL — `ToolExecutionEntrySchema` is not exported

- [ ] Step 3: Implement journal entry types

**File:** `src/hexagons/execution/domain/journal-entry.schemas.ts`

Add before the discriminated union block (after `ExecutionLifecycleEntrySchema`):

```typescript
export const ToolExecutionEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("tool-execution"),
  taskId: IdSchema,
  turnIndex: z.number().int().min(0),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  durationMs: z.number().int().min(0),
  isError: z.boolean(),
});
export type ToolExecutionEntry = z.infer<typeof ToolExecutionEntrySchema>;

export const TurnBoundaryEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("turn-boundary"),
  taskId: IdSchema,
  turnIndex: z.number().int().min(0),
  boundary: z.enum(["start", "end"]),
  toolCallCount: z.number().int().min(0).optional(),
});
export type TurnBoundaryEntry = z.infer<typeof TurnBoundaryEntrySchema>;
```

Update the `JournalEntrySchema` discriminated union to include both new schemas:

```typescript
export const JournalEntrySchema = z.discriminatedUnion("type", [
  TaskStartedEntrySchema,
  TaskCompletedEntrySchema,
  TaskFailedEntrySchema,
  FileWrittenEntrySchema,
  CheckpointSavedEntrySchema,
  PhaseChangedEntrySchema,
  ArtifactWrittenEntrySchema,
  GuardrailViolationEntrySchema,
  OverseerInterventionEntrySchema,
  ExecutionLifecycleEntrySchema,
  ToolExecutionEntrySchema,
  TurnBoundaryEntrySchema,
]);
```

- [ ] Step 4: Run test, verify PASS

**Run:** `npx vitest run src/hexagons/execution/domain/journal-entry.schemas.spec.ts`
**Expect:** PASS — all tests green (existing + new)

- [ ] Step 5: Commit

**Run:** `git add src/hexagons/execution/domain/journal-entry.schemas.ts src/hexagons/execution/domain/journal-entry.schemas.spec.ts && git commit -m "feat(S02/T03): add tool-execution and turn-boundary journal entry types"`

---

## Wave 1 (depends on Wave 0)

### T04: AgentEventPort + Barrel Exports
**Files:** Create `src/kernel/ports/agent-event.port.ts`, Modify `src/kernel/ports/index.ts`, Modify `src/kernel/index.ts`
**Traces to:** AC1
**Deps:** T01

- [ ] Step 1: Create AgentEventPort

**File:** `src/kernel/ports/agent-event.port.ts`

```typescript
import type { AgentEvent } from "@kernel/agents/agent-event.schema";

export type AgentEventListener = (event: AgentEvent) => void;
export type Unsubscribe = () => void;

export abstract class AgentEventPort {
  abstract subscribe(taskId: string, listener: AgentEventListener): Unsubscribe;
  abstract emit(taskId: string, event: AgentEvent): void;
  abstract clear(taskId: string): void;
}
```

- [ ] Step 2: Add barrel exports

**File:** `src/kernel/ports/index.ts` — append:

```typescript
export type { AgentEventListener, Unsubscribe } from "./agent-event.port";
export { AgentEventPort } from "./agent-event.port";
```

**File:** `src/kernel/index.ts` — add to the type exports from `"./ports"`:

```typescript
  AgentEventListener,
  Unsubscribe,
```

Add to the value exports from `"./ports"`:

```typescript
  AgentEventPort,
```

- [ ] Step 3: Run typecheck

**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors

- [ ] Step 4: Commit

**Run:** `git add src/kernel/ports/agent-event.port.ts src/kernel/ports/index.ts src/kernel/index.ts && git commit -m "feat(S02/T04): add AgentEventPort abstract class with barrel exports"`

---

### T05: AgentResult.turns Enrichment + Builder
**Files:** Modify `src/kernel/agents/agent-result.schema.ts`, Modify `src/kernel/agents/agent-result.builder.ts`, Modify `src/kernel/agents/agent-result.schema.spec.ts`, Modify `src/kernel/agents/agent-result.builder.spec.ts`
**Traces to:** AC5
**Deps:** T02

- [ ] Step 1: Write failing tests

**File:** `src/kernel/agents/agent-result.schema.spec.ts` — add to the `AgentResultSchema` describe block:

```typescript
  it("defaults turns to empty array", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "fixer",
      status: "DONE",
      output: "Done",
      selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
      cost: {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
      },
      durationMs: 1000,
    });
    expect(result.turns).toEqual([]);
  });

  it("parses result with turn metrics", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "fixer",
      status: "DONE",
      output: "Done",
      selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
      cost: {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
      },
      durationMs: 5000,
      turns: [
        {
          turnIndex: 0,
          toolCalls: [
            { toolCallId: "tc_1", toolName: "Read", durationMs: 50, isError: false },
          ],
          durationMs: 3000,
        },
        { turnIndex: 1, durationMs: 2000 },
      ],
    });
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0].toolCalls).toHaveLength(1);
    expect(result.turns[1].toolCalls).toEqual([]);
  });
```

**File:** `src/kernel/agents/agent-result.builder.spec.ts` — add:

```typescript
  it("defaults turns to empty array", () => {
    const result = new AgentResultBuilder().build();
    expect(result.turns).toEqual([]);
  });

  it("overrides turns with withTurns()", () => {
    const turns = [
      {
        turnIndex: 0,
        toolCalls: [
          { toolCallId: "tc_1", toolName: "Read", durationMs: 100, isError: false },
        ],
        durationMs: 5000,
      },
    ];
    const result = new AgentResultBuilder().withTurns(turns).build();
    expect(result.turns).toEqual(turns);
  });
```

- [ ] Step 2: Run test, verify FAIL

**Run:** `npx vitest run src/kernel/agents/agent-result.schema.spec.ts src/kernel/agents/agent-result.builder.spec.ts`
**Expect:** FAIL — `turns` property does not exist / `withTurns` is not a function

- [ ] Step 3: Implement

**File:** `src/kernel/agents/agent-result.schema.ts`

Add import at top:
```typescript
import { TurnMetricsSchema } from "./turn-metrics.schema";
```

Add `turns` field to `AgentResultSchema` after `durationMs`:
```typescript
  turns: z.array(TurnMetricsSchema).default([]),
```

**File:** `src/kernel/agents/agent-result.builder.ts`

Add import:
```typescript
import type { TurnMetrics } from "./turn-metrics.schema";
```

Add private field after `private _error?`:
```typescript
  private _turns: TurnMetrics[] = [];
```

Add method after `withError`:
```typescript
  withTurns(turns: TurnMetrics[]): this {
    this._turns = turns;
    return this;
  }
```

Add `turns: this._turns` to the `build()` parse object (after `error: this._error`).

**File:** `src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts`

Add `turns: [],` to the `return ok({...})` object at line 185 (after `durationMs,`). This prevents an intermediate type error since `satisfies AgentResult` now requires the `turns` field. T08 will later replace this with `collector?.toMetrics() ?? []`.

- [ ] Step 4: Run test, verify PASS

**Run:** `npx vitest run src/kernel/agents/agent-result.schema.spec.ts src/kernel/agents/agent-result.builder.spec.ts`
**Expect:** PASS — all tests green

- [ ] Step 5: Run typecheck to confirm no breakage

**Run:** `npx tsc --noEmit`
**Expect:** PASS — adapter compiles with `turns: []`

- [ ] Step 6: Commit

**Run:** `git add src/kernel/agents/agent-result.schema.ts src/kernel/agents/agent-result.builder.ts src/kernel/agents/agent-result.schema.spec.ts src/kernel/agents/agent-result.builder.spec.ts src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts && git commit -m "feat(S02/T05): add turns field to AgentResult with TurnMetrics array"`

---

### T06: TurnMetricsCollector
**Files:** Create `src/hexagons/execution/domain/turn-metrics-collector.ts`, Create `src/hexagons/execution/domain/turn-metrics-collector.spec.ts`
**Traces to:** AC6
**Deps:** T01, T02

- [ ] Step 1: Write failing test

**File:** `src/hexagons/execution/domain/turn-metrics-collector.spec.ts`

```typescript
import type { AgentEvent } from "@kernel/agents/agent-event.schema";
import { describe, expect, it } from "vitest";
import { TurnMetricsCollector } from "./turn-metrics-collector";

const TASK_ID = crypto.randomUUID();

function event(
  overrides: Partial<AgentEvent> & { type: AgentEvent["type"] },
): AgentEvent {
  return {
    taskId: TASK_ID,
    turnIndex: 0,
    timestamp: Date.now(),
    ...overrides,
  } as AgentEvent;
}

describe("TurnMetricsCollector", () => {
  it("produces empty array when no events recorded", () => {
    const collector = new TurnMetricsCollector();
    expect(collector.toMetrics()).toEqual([]);
  });

  it("produces one turn from turn_start + turn_end", () => {
    const collector = new TurnMetricsCollector();
    collector.record(
      event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }),
    );
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 0,
        timestamp: 4000,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].turnIndex).toBe(0);
    expect(metrics[0].durationMs).toBe(3000);
    expect(metrics[0].toolCalls).toEqual([]);
  });

  it("accumulates tool calls within a turn", () => {
    const collector = new TurnMetricsCollector();
    collector.record(
      event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }),
    );
    collector.record(
      event({
        type: "tool_execution_end",
        turnIndex: 0,
        toolCallId: "tc_1",
        toolName: "Read",
        isError: false,
        durationMs: 50,
        timestamp: 1500,
      }),
    );
    collector.record(
      event({
        type: "tool_execution_end",
        turnIndex: 0,
        toolCallId: "tc_2",
        toolName: "Edit",
        isError: false,
        durationMs: 100,
        timestamp: 2000,
      }),
    );
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 2,
        timestamp: 3000,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics[0].toolCalls).toHaveLength(2);
    expect(metrics[0].toolCalls[0].toolName).toBe("Read");
    expect(metrics[0].toolCalls[1].toolName).toBe("Edit");
  });

  it("tracks multiple turns", () => {
    const collector = new TurnMetricsCollector();
    collector.record(
      event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }),
    );
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 0,
        timestamp: 2000,
      }),
    );
    collector.record(
      event({ type: "turn_start", turnIndex: 1, timestamp: 2000 }),
    );
    collector.record(
      event({
        type: "tool_execution_end",
        turnIndex: 1,
        toolCallId: "tc_1",
        toolName: "Bash",
        isError: true,
        durationMs: 200,
        timestamp: 2500,
      }),
    );
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 1,
        toolCallCount: 1,
        timestamp: 3000,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics).toHaveLength(2);
    expect(metrics[0].durationMs).toBe(1000);
    expect(metrics[1].durationMs).toBe(1000);
    expect(metrics[1].toolCalls[0].isError).toBe(true);
  });

  it("handles partial turn (no turn_end) with durationMs = 0", () => {
    const collector = new TurnMetricsCollector();
    collector.record(
      event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }),
    );
    collector.record(
      event({
        type: "tool_execution_end",
        turnIndex: 0,
        toolCallId: "tc_1",
        toolName: "Read",
        isError: false,
        durationMs: 50,
        timestamp: 1500,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].durationMs).toBe(0);
    expect(metrics[0].toolCalls).toHaveLength(1);
  });

  it("toMetrics() is idempotent", () => {
    const collector = new TurnMetricsCollector();
    collector.record(
      event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }),
    );
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 0,
        timestamp: 2000,
      }),
    );

    const first = collector.toMetrics();
    const second = collector.toMetrics();
    expect(first).toEqual(second);
  });

  it("ignores message events", () => {
    const collector = new TurnMetricsCollector();
    collector.record(
      event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }),
    );
    collector.record(
      event({ type: "message_start", turnIndex: 0, timestamp: 1100 }),
    );
    collector.record(
      event({
        type: "message_update",
        turnIndex: 0,
        textDelta: "hi",
        timestamp: 1200,
      }),
    );
    collector.record(
      event({ type: "message_end", turnIndex: 0, timestamp: 1300 }),
    );
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 0,
        timestamp: 2000,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].toolCalls).toEqual([]);
  });

  it("ignores tool_execution_start and tool_execution_update", () => {
    const collector = new TurnMetricsCollector();
    collector.record(
      event({ type: "turn_start", turnIndex: 0, timestamp: 1000 }),
    );
    collector.record(
      event({
        type: "tool_execution_start",
        turnIndex: 0,
        toolCallId: "tc_1",
        toolName: "Read",
        timestamp: 1100,
      }),
    );
    collector.record(
      event({
        type: "tool_execution_update",
        turnIndex: 0,
        toolCallId: "tc_1",
        toolName: "Read",
        timestamp: 1200,
      }),
    );
    collector.record(
      event({
        type: "turn_end",
        turnIndex: 0,
        toolCallCount: 0,
        timestamp: 2000,
      }),
    );

    const metrics = collector.toMetrics();
    expect(metrics[0].toolCalls).toEqual([]);
  });
});
```

- [ ] Step 2: Run test, verify FAIL

**Run:** `npx vitest run src/hexagons/execution/domain/turn-metrics-collector.spec.ts`
**Expect:** FAIL — Cannot find module `./turn-metrics-collector`

- [ ] Step 3: Implement TurnMetricsCollector

**File:** `src/hexagons/execution/domain/turn-metrics-collector.ts`

```typescript
import type { AgentEvent } from "@kernel/agents/agent-event.schema";
import type { ToolCallMetrics, TurnMetrics } from "@kernel/agents/turn-metrics.schema";

interface TurnAccumulator {
  turnIndex: number;
  startTimestamp: number;
  endTimestamp: number | null;
  toolCalls: ToolCallMetrics[];
}

export class TurnMetricsCollector {
  private readonly turns: TurnAccumulator[] = [];

  record(event: AgentEvent): void {
    switch (event.type) {
      case "turn_start":
        this.turns.push({
          turnIndex: event.turnIndex,
          startTimestamp: event.timestamp,
          endTimestamp: null,
          toolCalls: [],
        });
        break;
      case "turn_end": {
        const turn = this.findTurn(event.turnIndex);
        if (turn) turn.endTimestamp = event.timestamp;
        break;
      }
      case "tool_execution_end": {
        const turn = this.findTurn(event.turnIndex);
        if (turn) {
          turn.toolCalls.push({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            durationMs: event.durationMs,
            isError: event.isError,
          });
        }
        break;
      }
      // message_start, message_end, message_update,
      // tool_execution_start, tool_execution_update — ignored
    }
  }

  toMetrics(): TurnMetrics[] {
    return this.turns.map((t) => ({
      turnIndex: t.turnIndex,
      toolCalls: [...t.toolCalls],
      durationMs:
        t.endTimestamp !== null ? t.endTimestamp - t.startTimestamp : 0,
    }));
  }

  private findTurn(turnIndex: number): TurnAccumulator | undefined {
    return this.turns.find((t) => t.turnIndex === turnIndex);
  }
}
```

- [ ] Step 4: Run test, verify PASS

**Run:** `npx vitest run src/hexagons/execution/domain/turn-metrics-collector.spec.ts`
**Expect:** PASS — all tests green

- [ ] Step 5: Commit

**Run:** `git add src/hexagons/execution/domain/turn-metrics-collector.ts src/hexagons/execution/domain/turn-metrics-collector.spec.ts && git commit -m "feat(S02/T06): add TurnMetricsCollector for per-turn metric accumulation"`

---

## Wave 2 (depends on Wave 1)

### T07: InMemoryAgentEventHub
**Files:** Create `src/kernel/infrastructure/in-memory-agent-event-hub.ts`, Create `src/kernel/infrastructure/in-memory-agent-event-hub.spec.ts`, Modify `src/kernel/infrastructure/index.ts`, Modify `src/kernel/index.ts`
**Traces to:** AC2
**Deps:** T04

- [ ] Step 1: Write failing test

**File:** `src/kernel/infrastructure/in-memory-agent-event-hub.spec.ts`

```typescript
import type { AgentEvent } from "@kernel/agents/agent-event.schema";
import { describe, expect, it } from "vitest";
import { InMemoryAgentEventHub } from "./in-memory-agent-event-hub";

const TASK_A = crypto.randomUUID();
const TASK_B = crypto.randomUUID();

function turnStart(taskId: string, turnIndex = 0): AgentEvent {
  return { type: "turn_start", taskId, turnIndex, timestamp: Date.now() };
}

describe("InMemoryAgentEventHub", () => {
  it("delivers event to subscribed listener", () => {
    const hub = new InMemoryAgentEventHub();
    const received: AgentEvent[] = [];
    hub.subscribe(TASK_A, (e) => received.push(e));

    const event = turnStart(TASK_A);
    hub.emit(TASK_A, event);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(event);
  });

  it("delivers to multiple listeners for same task", () => {
    const hub = new InMemoryAgentEventHub();
    const r1: AgentEvent[] = [];
    const r2: AgentEvent[] = [];
    hub.subscribe(TASK_A, (e) => r1.push(e));
    hub.subscribe(TASK_A, (e) => r2.push(e));

    hub.emit(TASK_A, turnStart(TASK_A));

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it("isolates events per task", () => {
    const hub = new InMemoryAgentEventHub();
    const taskAEvents: AgentEvent[] = [];
    const taskBEvents: AgentEvent[] = [];
    hub.subscribe(TASK_A, (e) => taskAEvents.push(e));
    hub.subscribe(TASK_B, (e) => taskBEvents.push(e));

    hub.emit(TASK_A, turnStart(TASK_A));
    hub.emit(TASK_B, turnStart(TASK_B));

    expect(taskAEvents).toHaveLength(1);
    expect(taskBEvents).toHaveLength(1);
    expect(taskAEvents[0].taskId).toBe(TASK_A);
    expect(taskBEvents[0].taskId).toBe(TASK_B);
  });

  it("unsubscribe stops event delivery", () => {
    const hub = new InMemoryAgentEventHub();
    const received: AgentEvent[] = [];
    const unsub = hub.subscribe(TASK_A, (e) => received.push(e));

    hub.emit(TASK_A, turnStart(TASK_A));
    unsub();
    hub.emit(TASK_A, turnStart(TASK_A));

    expect(received).toHaveLength(1);
  });

  it("clear() removes all listeners for a task", () => {
    const hub = new InMemoryAgentEventHub();
    const received: AgentEvent[] = [];
    hub.subscribe(TASK_A, (e) => received.push(e));
    hub.subscribe(TASK_A, (e) => received.push(e));

    hub.clear(TASK_A);
    hub.emit(TASK_A, turnStart(TASK_A));

    expect(received).toHaveLength(0);
  });

  it("clear() does not affect other tasks", () => {
    const hub = new InMemoryAgentEventHub();
    const taskBEvents: AgentEvent[] = [];
    hub.subscribe(TASK_A, () => {});
    hub.subscribe(TASK_B, (e) => taskBEvents.push(e));

    hub.clear(TASK_A);
    hub.emit(TASK_B, turnStart(TASK_B));

    expect(taskBEvents).toHaveLength(1);
  });

  it("emit with no listeners is a no-op", () => {
    const hub = new InMemoryAgentEventHub();
    expect(() => hub.emit(TASK_A, turnStart(TASK_A))).not.toThrow();
  });

  it("clear on non-existent task is a no-op", () => {
    const hub = new InMemoryAgentEventHub();
    expect(() => hub.clear(TASK_A)).not.toThrow();
  });
});
```

- [ ] Step 2: Run test, verify FAIL

**Run:** `npx vitest run src/kernel/infrastructure/in-memory-agent-event-hub.spec.ts`
**Expect:** FAIL — Cannot find module `./in-memory-agent-event-hub`

- [ ] Step 3: Implement InMemoryAgentEventHub

**File:** `src/kernel/infrastructure/in-memory-agent-event-hub.ts`

```typescript
import type { AgentEvent } from "@kernel/agents/agent-event.schema";
import {
  AgentEventPort,
  type AgentEventListener,
  type Unsubscribe,
} from "@kernel/ports/agent-event.port";

export class InMemoryAgentEventHub extends AgentEventPort {
  private readonly listeners = new Map<string, Set<AgentEventListener>>();

  subscribe(taskId: string, listener: AgentEventListener): Unsubscribe {
    let set = this.listeners.get(taskId);
    if (!set) {
      set = new Set();
      this.listeners.set(taskId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  emit(taskId: string, event: AgentEvent): void {
    const set = this.listeners.get(taskId);
    if (!set) return;
    for (const listener of set) {
      listener(event);
    }
  }

  clear(taskId: string): void {
    this.listeners.delete(taskId);
  }
}
```

- [ ] Step 4: Add barrel exports

**File:** `src/kernel/infrastructure/index.ts` — append:

```typescript
export { InMemoryAgentEventHub } from "./in-memory-agent-event-hub";
```

**File:** `src/kernel/index.ts` — add `InMemoryAgentEventHub` to the infrastructure re-export block.

- [ ] Step 5: Run test, verify PASS

**Run:** `npx vitest run src/kernel/infrastructure/in-memory-agent-event-hub.spec.ts`
**Expect:** PASS — all tests green

- [ ] Step 6: Commit

**Run:** `git add src/kernel/infrastructure/in-memory-agent-event-hub.ts src/kernel/infrastructure/in-memory-agent-event-hub.spec.ts src/kernel/infrastructure/index.ts src/kernel/index.ts && git commit -m "feat(S02/T07): add InMemoryAgentEventHub with per-task listener isolation"`

---

## Wave 3 (depends on all previous waves)

### T08: PiAgentDispatchAdapter Event Wiring
**Files:** Modify `src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts`
**Traces to:** AC3, AC4, AC5, AC7
**Deps:** T01–T07

- [ ] Step 1: Add imports

**File:** `src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts`

Add to existing imports:

```typescript
import type { AgentEventPort } from "@kernel/ports";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import type { JournalRepositoryPort } from "../domain/ports/journal-repository.port";
import { TurnMetricsCollector } from "../domain/turn-metrics-collector";
```

- [ ] Step 2: Extend PiAgentDispatchDeps

Add two optional fields to the `PiAgentDispatchDeps` interface:

```typescript
  readonly agentEventPort?: AgentEventPort;
  readonly journalRepository?: JournalRepositoryPort;
```

- [ ] Step 3: Update constructor

Store new deps in the constructor:

```typescript
    this.deps = {
      resolveModel: deps?.resolveModel ?? resolveModel,
      authStorage: deps?.authStorage,
      modelRegistry: deps?.modelRegistry,
      agentEventPort: deps?.agentEventPort,
      journalRepository: deps?.journalRepository,
    };
```

- [ ] Step 4: Add extractTextDelta helper

Add module-level helper after `resolveModel()`:

```typescript
function extractTextDelta(event: AssistantMessageEvent): string | null {
  return event.type === "text_delta" ? event.delta : null;
}
```

- [ ] Step 5: Wire event streaming in dispatch()

In `dispatch()`, declare variables in the outer try scope (before session creation):

```typescript
    let collector: TurnMetricsCollector | undefined;
    let unsubEvents: (() => void) | undefined;
```

After `this.running.set(config.taskId, session)` and before `const startTime = Date.now()`, add event wiring block:

```typescript
      const agentEventPort = this.deps.agentEventPort;
      const journalRepo = this.deps.journalRepository;

      if (agentEventPort) {
        collector = new TurnMetricsCollector();
        const unsubCollector = agentEventPort.subscribe(
          config.taskId,
          (e) => collector!.record(e),
        );

        let turnIndex = -1;
        let toolCallsInTurn = 0;
        const toolStartTimes = new Map<string, number>();

        const unsubSession = session.subscribe((piEvent) => {
          const now = Date.now();
          switch (piEvent.type) {
            case "turn_start":
              turnIndex++;
              toolCallsInTurn = 0;
              agentEventPort.emit(config.taskId, {
                type: "turn_start",
                taskId: config.taskId,
                turnIndex,
                timestamp: now,
              });
              if (journalRepo) {
                journalRepo.append(config.sliceId, {
                  type: "turn-boundary",
                  sliceId: config.sliceId,
                  timestamp: new Date(now),
                  taskId: config.taskId,
                  turnIndex,
                  boundary: "start",
                }).catch(() => {});
              }
              break;
            case "turn_end":
              agentEventPort.emit(config.taskId, {
                type: "turn_end",
                taskId: config.taskId,
                turnIndex,
                toolCallCount: toolCallsInTurn,
                timestamp: now,
              });
              if (journalRepo) {
                journalRepo.append(config.sliceId, {
                  type: "turn-boundary",
                  sliceId: config.sliceId,
                  timestamp: new Date(now),
                  taskId: config.taskId,
                  turnIndex,
                  boundary: "end",
                  toolCallCount: toolCallsInTurn,
                }).catch(() => {});
              }
              toolCallsInTurn = 0;
              break;
            case "message_start":
            case "message_end":
              agentEventPort.emit(config.taskId, {
                type: piEvent.type,
                taskId: config.taskId,
                turnIndex,
                timestamp: now,
              });
              break;
            case "message_update": {
              const delta = extractTextDelta(piEvent.assistantMessageEvent);
              if (delta) {
                agentEventPort.emit(config.taskId, {
                  type: "message_update",
                  taskId: config.taskId,
                  turnIndex,
                  textDelta: delta,
                  timestamp: now,
                });
              }
              break;
            }
            case "tool_execution_start":
              toolCallsInTurn++;
              toolStartTimes.set(piEvent.toolCallId, now);
              agentEventPort.emit(config.taskId, {
                type: "tool_execution_start",
                taskId: config.taskId,
                turnIndex,
                toolCallId: piEvent.toolCallId,
                toolName: piEvent.toolName,
                timestamp: now,
              });
              break;
            case "tool_execution_update":
              agentEventPort.emit(config.taskId, {
                type: "tool_execution_update",
                taskId: config.taskId,
                turnIndex,
                toolCallId: piEvent.toolCallId,
                toolName: piEvent.toolName,
                timestamp: now,
              });
              break;
            case "tool_execution_end": {
              const startTime = toolStartTimes.get(piEvent.toolCallId) ?? now;
              const durationMs = now - startTime;
              agentEventPort.emit(config.taskId, {
                type: "tool_execution_end",
                taskId: config.taskId,
                turnIndex,
                toolCallId: piEvent.toolCallId,
                toolName: piEvent.toolName,
                isError: piEvent.isError,
                durationMs,
                timestamp: now,
              });
              toolStartTimes.delete(piEvent.toolCallId);
              if (journalRepo) {
                journalRepo.append(config.sliceId, {
                  type: "tool-execution",
                  sliceId: config.sliceId,
                  timestamp: new Date(now),
                  taskId: config.taskId,
                  turnIndex,
                  toolCallId: piEvent.toolCallId,
                  toolName: piEvent.toolName,
                  durationMs,
                  isError: piEvent.isError,
                }).catch(() => {});
              }
              break;
            }
            // Skip: agent_start, agent_end, compaction_*, auto_retry_*, queue_update
          }
        });

        unsubEvents = () => {
          unsubSession();
          unsubCollector();
        };
      }
```

- [ ] Step 6: Add cleanup after session.prompt()

After `await session.prompt(prompt)` (existing line 130), before `const durationMs`:

```typescript
      if (unsubEvents) unsubEvents();
      if (agentEventPort) agentEventPort.clear(config.taskId);
```

- [ ] Step 7: Add turns to result

Change the `return ok({...})` to include `turns`:

```typescript
      const turns = collector?.toMetrics() ?? [];

      return ok({
        taskId: config.taskId,
        agentType: config.agentType,
        status,
        output,
        filesChanged: [],
        concerns,
        selfReview,
        cost,
        durationMs,
        turns,
      } satisfies AgentResult);
```

- [ ] Step 8: Add cleanup to catch block

In the catch block, add cleanup before existing logic:

```typescript
    } catch (e) {
      if (unsubEvents) unsubEvents();
      if (this.deps.agentEventPort) this.deps.agentEventPort.clear(config.taskId);
      this.running.delete(config.taskId);
      // ... rest unchanged
```

- [ ] Step 9: Run typecheck

**Run:** `npx tsc --noEmit`
**Expect:** PASS — if PI SDK type `AssistantMessageEvent` field access causes TS errors, adjust the import or cast. The research confirmed `piEvent.assistantMessageEvent` exists on `message_update` events and `piEvent.toolCallId`/`piEvent.toolName`/`piEvent.isError` exist on tool events.

- [ ] Step 10: Run existing contract tests

**Run:** `npx vitest run src/hexagons/execution/infrastructure/in-memory-agent-dispatch.adapter.spec.ts`
**Expect:** PASS — InMemoryAgentDispatchAdapter has no AgentEventPort deps, so unchanged.

- [ ] Step 11: Commit

**Run:** `git add src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts && git commit -m "feat(S02/T08): wire session.subscribe() event streaming in PiAgentDispatchAdapter"`

---

## Wave 4 (depends on T07, T08)

### T09: DI Wiring + Regression Verification
**Files:** Modify `src/cli/extension.ts`
**Traces to:** AC8, AC9
**Deps:** T07, T08

- [ ] Step 1: Add InMemoryAgentEventHub to shared infrastructure

**File:** `src/cli/extension.ts`

Add import:
```typescript
import { InMemoryAgentEventHub } from "@kernel/infrastructure/in-memory-agent-event-hub";
```

After the shared infrastructure block (after `const dateProvider = new SystemDateProvider();` at line 94), add:

```typescript
  const agentEventHub = new InMemoryAgentEventHub();
```

The hub is available for adapters that need event streaming. Currently, the review/verify/audit `PiAgentDispatchAdapter` instances don't require it — event streaming is only needed during execution. The hub will be passed when `ExecuteSliceUseCase` is fully wired.

- [ ] Step 2: Run full test suite

**Run:** `npx vitest run`
**Expect:** PASS — all existing + new tests green, no regressions

- [ ] Step 3: Run typecheck

**Run:** `npx tsc --noEmit`
**Expect:** PASS — no type errors

- [ ] Step 4: Run lint

**Run:** `npx biome check .`
**Expect:** PASS — no lint errors

- [ ] Step 5: Commit

**Run:** `git add src/cli/extension.ts && git commit -m "feat(S02/T09): add InMemoryAgentEventHub to DI composition root"`

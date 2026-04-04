# Research — M06-S02: Agent Event Deepening

## Investigation Summary

All 4 spec unknowns resolved by inspecting PI SDK type definitions in `node_modules`.

## Finding 1: AssistantMessageEvent Shape

**Source:** `@mariozechner/pi-ai/dist/types.d.ts` lines 163-216

`AssistantMessageEvent` is a discriminated union on `.type`:

| Type | Key Fields |
|------|------------|
| `start` | `partial: AssistantMessage` |
| `text_start` | `contentIndex`, `partial` |
| `text_delta` | `contentIndex`, **`delta: string`**, `partial` |
| `text_end` | `contentIndex`, `content: string`, `partial` |
| `thinking_start` | `contentIndex`, `partial` |
| `thinking_delta` | `contentIndex`, `delta: string`, `partial` |
| `thinking_end` | `contentIndex`, `content: string`, `partial` |
| `toolcall_start` | `contentIndex`, `partial` |
| `toolcall_delta` | `contentIndex`, `delta: string`, `partial` |
| `toolcall_end` | `contentIndex`, `toolCall: ToolCall`, `partial` |
| `done` | `reason: "stop" \| "length" \| "toolUse"`, `message: AssistantMessage` |
| `error` | `reason: "aborted" \| "error"`, `error: AssistantMessage` |

**`extractTextDelta` implementation:**

```typescript
function extractTextDelta(event: AssistantMessageEvent): string | null {
  return event.type === "text_delta" ? event.delta : null;
}
```

Only `text_delta` carries incremental text. All other types either carry no text, carry full content (text_end), or are for thinking/toolcall streams.

## Finding 2: session.subscribe() API

**Source:** `@mariozechner/pi-coding-agent/dist/core/agent-session.d.ts` lines 214-219

```typescript
subscribe(listener: AgentSessionEventListener): () => void;
```

- Method name: `subscribe` (confirmed — NOT `on()` as R02 states)
- Parameter: `AgentSessionEventListener` which is `(event: AgentSessionEvent) => void`
- Return: unsubscribe function `() => void`
- Multiple listeners supported (documented in JSDoc)
- `AgentSessionEvent = AgentEvent | { type: "queue_update" | "compaction_start" | "compaction_end" | "auto_retry_start" | "auto_retry_end" }`

**Spec impact:** None — spec already uses `session.subscribe()`. Confirmed correct.

## Finding 3: turn_end.toolResults Structure

**Source:** `@mariozechner/pi-agent-core/dist/types.d.ts` lines 256-258

```typescript
{
  type: "turn_end";
  message: AgentMessage;
  toolResults: ToolResultMessage[];
}
```

- `toolResults` is typed as `ToolResultMessage[]` — **NOT optional**. Always an array (may be empty `[]`).
- `ToolResultMessage` has fields: `role: "toolResult"`, `toolCallId`, `toolName`, `content`, `details?`, `isError`, `timestamp`.

**Spec impact:** The spec's `toolCallsInTurn` counter (derived from `tool_execution_start`) is the correct approach. `toolResults.length` would also work but has different semantics (results vs calls). The counter approach is more reliable since it counts what the adapter actually observed.

## Finding 4: agent_start / agent_end Events

**Source:** `@mariozechner/pi-agent-core/dist/types.d.ts` lines 248-252

```typescript
{ type: "agent_start" }
{ type: "agent_end"; messages: AgentMessage[] }
```

- `agent_start`: no payload, just a lifecycle marker.
- `agent_end`: carries `messages: AgentMessage[]` — the full conversation history.

**Decision: Skip both.** Rationale:
- `agent_start` carries no useful data beyond what `turn_start` (first turn) provides.
- `agent_end.messages` is the full conversation — redundant with `session.getLastAssistantText()` which the adapter already reads. The full message array could be useful for deep analysis but is out of scope for S02 (event streaming, not conversation replay).
- Neither event maps to the 8 domain event types in the spec.

## Finding 5: AgentMessage Shape (bonus)

**Source:** `@mariozechner/pi-agent-core/dist/types.d.ts`

`AgentMessage` is `UserMessage | AssistantMessage | ToolResultMessage`. The `message_start/update/end` events carry `message: AgentMessage` but for domain purposes we only extract `textDelta` from `message_update`. The full message object is not needed in domain events.

`AssistantMessage.usage: Usage` contains `{ input, output, cacheRead, cacheWrite, totalTokens, cost: { input, output } }`. This is available on `message_end.message` but per-message, not per-turn. Since `session.getSessionStats()` provides aggregate totals, and the PI SDK doesn't expose per-turn token breakdowns through the event system, per-turn token metrics remain out of scope (confirmed in spec).

## Spec Updates Required

None. All spec decisions validated by research:

1. `extractTextDelta` → discriminate on `event.type === "text_delta"`, return `event.delta` ✓
2. `session.subscribe(listener)` → returns `() => void` ✓
3. `toolResults: ToolResultMessage[]` → always array, never undefined. Counter approach preferred ✓
4. `agent_start`/`agent_end` → skip confirmed ✓
5. `toolCallsInTurn` counter → already in spec after review fixes ✓

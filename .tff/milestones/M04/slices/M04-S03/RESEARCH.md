# M04-S03 Research: PI SDK Agent Session API

## 1. Installation

`@mariozechner/pi-coding-agent@0.64.0` installed successfully. 244 transitive deps, 0 vulnerabilities, no conflicts with Zod 4 or better-sqlite3. Transitive deps include `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@sinclair/typebox`.

## 2. Session Creation

```typescript
import { createAgentSession } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';

const { session } = await createAgentSession({
  cwd: workingDirectory,
  model: getModel('anthropic', 'claude-sonnet-4-5'),
  tools: [readTool, bashTool, editTool, writeTool],  // Built-in Tool instances
  customTools: [],                                      // Additional ToolDefinitions
  sessionManager: SessionManager.inMemory(),            // No file persistence
});
```

**Key:** `CreateAgentSessionOptions` has no `systemPrompt` field. System prompt is built internally from `resourceLoader`. Options: `cwd`, `agentDir`, `authStorage`, `modelRegistry`, `model`, `thinkingLevel`, `tools`, `customTools`, `resourceLoader`, `sessionManager`, `settingsManager`.

## 3. Model Resolution

```typescript
import { getModel } from '@mariozechner/pi-ai';

// getModel(provider, modelId) -> Model<any>
const model = getModel('anthropic', 'claude-opus-4-5');
```

Our `ResolvedModel` (`{ provider, modelId }`) maps directly to `getModel(provider, modelId)`. The adapter calls this to convert.

`KnownProvider` is a string union of supported providers (anthropic, etc.).

## 4. Prompt Execution

```typescript
// session.prompt(text, options?) -> Promise<void>
await session.prompt(taskPrompt);
```

**Returns `Promise<void>`** -- NOT a result object. The promise resolves when the agent finishes all turns (including tool calls). To extract output:

```typescript
// After prompt() resolves:
const output = session.getLastAssistantText();           // string | undefined
const state = session.state;                             // AgentState { messages, error, ... }
```

**AgentState**: `{ systemPrompt, model, thinkingLevel, tools, messages: AgentMessage[], isStreaming, streamMessage, pendingToolCalls, error?: string }`

**StopReason**: `"stop" | "length" | "toolUse" | "error" | "aborted"`

## 5. System Prompt Injection

No direct `systemPrompt` setter. Three options:

1. **Prepend to task prompt** (simplest): Concatenate `config.systemPrompt + "\n\n" + config.taskPrompt` and pass as single `session.prompt()` call. System prompt content appears as user message context.
2. **Custom ResourceLoader**: Inject skills via resource loader so they appear in the base system prompt.
3. **steer()**: Use `session.steer()` to inject context while agent is running.

**Recommendation**: Option 1 (prepend to prompt). Clean, simple, no SDK internals. The system prompt is just skill/context markdown -- works fine as user message context.

## 6. Cost Extraction

```typescript
const stats: SessionStats = session.getSessionStats();
// stats.tokens = { input: number, output: number, cacheRead: number, cacheWrite: number, total: number }
// stats.cost = number  (USD)
```

Maps to our `AgentCostSchema`:
- `provider` -> from `config.model.provider`
- `modelId` -> from `config.model.modelId`
- `inputTokens` -> `stats.tokens.input`
- `outputTokens` -> `stats.tokens.output`
- `costUsd` -> `stats.cost`

`ContextUsage` type (from `session.getContextUsage()`) only has `{ tokens, contextWindow, percent }` -- NOT useful for cost tracking.

## 7. Files Changed Extraction

PI SDK does NOT track files changed natively. Two approaches:

**Approach A (event-based)**: Subscribe to extension events, capture edit/write tool calls:
```typescript
// Extension event handler via extensionRunner:
// on("tool_call", handler) -> EditToolCallEvent { input: { path } }
// on("tool_call", handler) -> WriteToolCallEvent { input: { path } }
```
Both `EditToolInput` and `WriteToolInput` have a `path: string` field.

**Approach B (git diff)**: After prompt completes, run `git diff --name-only` in the working directory.

**Recommendation**: Approach B (git diff). Simpler, more reliable, catches all changes including bash-initiated writes. Event-based tracking would miss `bash` tool file operations.

## 8. Abort Mechanism

```typescript
// Direct method on AgentSession:
await session.abort();  // Aborts current operation, waits for idle
```

**NOT** `session.context.abort()` (M02 research was wrong). `session.abort()` is a proper async method that returns `Promise<void>` and waits for the agent to become idle.

## 9. Error Handling

No custom error classes in PI SDK. Errors manifest as:
- `AgentState.error?: string` -- error message on state
- `StopReason: "error" | "aborted"` -- on the last assistant message
- `AssistantMessage.errorMessage?: string` -- detailed error text
- Thrown exceptions from `createAgentSession()` or `session.prompt()`

**Auto-retry**: AgentSession has built-in retry for "overloaded, rate limit, server errors". Context overflow is NOT retried (handled by compaction). The `_isRetryableError` method is private.

**Mapping to AgentDispatchError**:
- Session creation throws -> `sessionCreationFailed`
- `StopReason === "aborted"` -> `sessionAborted`
- `StopReason === "error"` -> inspect `errorMessage` for classification, default to `unexpectedFailure`
- Timeout (external) -> `sessionTimedOut`

**Decision**: Keep the 4 error variants. Rate limits are auto-retried by PI SDK. Context overflow is an `unexpectedFailure` (the caller should ensure prompts fit). Auth errors would surface during `createAgentSession()` as `sessionCreationFailed`.

## 10. Integration Testing with Faux Provider

```typescript
import { registerFauxProvider, fauxText, fauxAssistantMessage } from '@mariozechner/pi-ai/providers/faux';

// Register a fake LLM that returns scripted responses
const faux = registerFauxProvider();
faux.setResponses([
  fauxAssistantMessage("Task completed successfully"),
]);

const { session } = await createAgentSession({
  model: faux.getModel(),
  sessionManager: SessionManager.inMemory(),
  tools: [],  // No tools for simple test
});

await session.prompt("Do the task");
const output = session.getLastAssistantText(); // "Task completed successfully"

faux.unregister();  // Cleanup
```

**Key capabilities**:
- `FauxResponseFactory`: Dynamic responses based on context
- `fauxToolCall()`: Script tool calls for testing tool execution paths
- `state.callCount`: Track how many LLM calls were made
- `getPendingResponseCount()`: Verify all responses consumed
- `FauxModelDefinition.cost`: Configure cost rates for cost extraction testing

**No ENV gating needed**. No real API calls. No cost. Fully in-process.

## 11. Revised Adapter Design

```typescript
export class PiAgentDispatchAdapter extends AgentDispatchPort {
  private readonly running = new Map<string, AgentSession>();

  async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
    try {
      // 1. Resolve model
      const model = getModel(config.model.provider, config.model.modelId);

      // 2. Create fresh session (isolated context window)
      const { session } = await createAgentSession({
        cwd: config.workingDirectory,
        model,
        tools: resolveTools(config.tools),
        sessionManager: SessionManager.inMemory(),
      });

      // 3. Track for abort
      this.running.set(config.taskId, session);

      // 4. Execute task (system prompt prepended to task prompt)
      const startTime = Date.now();
      const prompt = config.systemPrompt
        ? `${config.systemPrompt}\n\n---\n\n${config.taskPrompt}`
        : config.taskPrompt;
      await session.prompt(prompt);

      // 5. Extract results
      const durationMs = Date.now() - startTime;
      const stats = session.getSessionStats();
      const output = session.getLastAssistantText() ?? '';
      const error = session.state.error;
      const filesChanged = await getFilesChanged(config.workingDirectory);

      // 6. Cleanup
      this.running.delete(config.taskId);
      session.dispose();

      return ok({
        taskId: config.taskId,
        agentType: config.agentType,
        success: !error,
        output,
        filesChanged,
        cost: {
          provider: config.model.provider,
          modelId: config.model.modelId,
          inputTokens: stats.tokens.input,
          outputTokens: stats.tokens.output,
          costUsd: stats.cost,
        },
        durationMs,
        error,
      });
    } catch (e) {
      this.running.delete(config.taskId);
      return err(AgentDispatchError.sessionCreationFailed(config.taskId, e));
    }
  }

  async abort(taskId: string): Promise<void> {
    const session = this.running.get(taskId);
    if (session) {
      await session.abort();
      this.running.delete(taskId);
    }
  }

  isRunning(taskId: string): boolean {
    return this.running.has(taskId);
  }
}
```

## 12. Spec Impact

Research findings that change the spec:

| Spec Assumption | Actual API | Impact |
|---|---|---|
| `session.prompt()` returns result | Returns `Promise<void>` | Use `getLastAssistantText()` + `getSessionStats()` |
| `session.context.abort()` | `session.abort()` | Simpler -- direct method on session |
| `systemPrompt` in options | Not available | Prepend to task prompt |
| `extractCost(session)` | `session.getSessionStats()` | Direct mapping to `AgentCostSchema` |
| `extractFilesChanged(session)` | Not tracked by SDK | Use `git diff --name-only` |
| Integration tests need real API | Faux provider available | No ENV gating, no cost |
| `running` Map stores `{ session, abort }` | Just stores `AgentSession` | Simpler -- session has abort() directly |

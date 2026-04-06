# M04-S03: Agent Dispatch Port + PI Adapter

## Problem

The execution engine needs to dispatch fresh AI agent sessions per task. No dispatch abstraction exists yet -- downstream slices S05 (cost tracking), S06 (agent status), S07 (wave engine), S08 (safety guardrails) all depend on this port contract.

## Requirement

R03: AgentDispatchPort abstract class, PiAgentDispatchAdapter, fresh session per task.

## Approach

Port + contract tests + PI adapter. Follows S01/S02 pattern: abstract port in `execution/domain/ports/`, contract test suite, InMemoryAdapter for unit tests, PiAgentDispatchAdapter wrapping PI SDK's `createAgentSession()`.

**Includes**: Install `@mariozechner/pi-coding-agent` as a dependency and wire the real PI adapter with working integration tests.

**Tier**: F-full (complex)

## Design

### AgentDispatchPort

```typescript
// execution/domain/ports/agent-dispatch.port.ts
export abstract class AgentDispatchPort {
  abstract dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>>;
  abstract abort(taskId: string): Promise<void>;
  abstract isRunning(taskId: string): boolean;
}
```

- Uses existing `AgentDispatchConfig` and `AgentResult` from `kernel/agents/`
- Returns `Result<AgentResult, AgentDispatchError>` -- no exceptions
- `abort(taskId)` -- separate port method, adapter tracks running sessions via Map
- `isRunning(taskId)` -- observability hook for S09 watchdog

### AgentDispatchError

```typescript
// execution/domain/errors/agent-dispatch.error.ts
export class AgentDispatchError extends BaseDomainError {
  static sessionCreationFailed(taskId: string, cause: unknown): AgentDispatchError;
  static sessionTimedOut(taskId: string, durationMs: number): AgentDispatchError;
  static sessionAborted(taskId: string): AgentDispatchError;
  static unexpectedFailure(taskId: string, cause: unknown): AgentDispatchError;
}
```

### InMemoryAgentDispatchAdapter

```typescript
// execution/infrastructure/in-memory-agent-dispatch.adapter.ts
export class InMemoryAgentDispatchAdapter extends AgentDispatchPort {
  private readonly running: Map<string, { resolve: () => void }>;
  private readonly results: Map<string, Result<AgentResult, AgentDispatchError>>;
  private readonly dispatched: AgentDispatchConfig[];

  // Test helpers
  givenResult(taskId: string, result: Result<AgentResult, AgentDispatchError>): void;
  givenDelayedResult(taskId: string, result: Result<...>, delayMs: number): void;

  // Inspection
  get dispatchedConfigs(): readonly AgentDispatchConfig[];
  wasDispatched(taskId: string): boolean;
}
```

### PiAgentDispatchAdapter

```typescript
// execution/infrastructure/pi-agent-dispatch.adapter.ts
export class PiAgentDispatchAdapter extends AgentDispatchPort {
  private readonly running: Map<string, { session: AgentSession; abort: () => void }>;

  async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
    // 1. createAgentSession({ cwd, model, customTools })
    // 2. Track in running map for abort support
    // 3. session.prompt(systemPrompt + taskPrompt)
    // 4. Extract cost, filesChanged, duration
    // 5. Cleanup running map
    // 6. Return ok(AgentResult) or err(AgentDispatchError)
  }

  async abort(taskId: string): Promise<void> {
    // session.context.abort() + remove from running map
  }

  isRunning(taskId: string): boolean {
    // running.has(taskId)
  }
}
```

**PI SDK API**: `createAgentSession()` from `@mariozechner/pi-coding-agent`
- Session creation: `{ cwd, model, customTools }`
- Task execution: `session.prompt(taskPrompt)`
- Abort: `session.context.abort()`
- Cost extraction: session stats after completion

### Contract Test Suite

Shared tests both adapters must pass:

| Group | Test |
|---|---|
| dispatch | Returns ok result for successful dispatch |
| dispatch | Returns error result for failed dispatch |
| dispatch | Creates isolated sessions (no bleed between tasks) |
| dispatch | Includes cost tracking data in result |
| dispatch | Includes duration in result |
| abort | Aborts a running agent by taskId |
| abort | Is no-op for unknown taskId |
| abort | isRunning returns false after abort |
| isRunning | Returns true while agent is dispatched |
| isRunning | Returns false after agent completes |
| isRunning | Returns false for never-dispatched taskId |

## File Structure

```
src/hexagons/execution/
  domain/
    ports/
      agent-dispatch.port.ts
    errors/
      agent-dispatch.error.ts
  infrastructure/
    agent-dispatch.contract.spec.ts
    in-memory-agent-dispatch.adapter.ts
    in-memory-agent-dispatch.adapter.spec.ts
    pi-agent-dispatch.adapter.ts
    pi-agent-dispatch.adapter.spec.ts
  index.ts  (updated barrel)
```

## Acceptance Criteria

1. **Fresh sessions**: Each `dispatch()` creates an independent agent session. Dispatching task B after task A does not carry over session state. Verified: dispatch two configs with different taskIds sequentially; each result contains only data from its own config.
2. **Cost tracking**: Agent results include cost tracking data (provider, modelId, inputTokens, outputTokens, costUsd) -- all required fields per `AgentCostSchema`.
3. **Abort**: Calling `abort(taskId)` on a running dispatch causes `dispatch()` to resolve with `err(AgentDispatchError.sessionAborted(taskId))`. Calling `abort` on an unknown taskId is a no-op. After abort, `isRunning(taskId)` returns `false`.
4. **isRunning observability**: `isRunning(taskId)` returns `true` while dispatch is in flight, `false` after completion or abort, `false` for never-dispatched taskIds.

## Research Requirements (from stress test)

The PI adapter design is based on M02-S07 research against PI SDK v0.62.0, inspected externally (not installed). The research phase MUST resolve:

1. **Install PI SDK**: `npm install @mariozechner/pi-coding-agent` -- verify no dependency conflicts
2. **session.prompt() signature**: Confirm return type, blocking behavior, and how to extract output
3. **System prompt injection**: `CreateAgentSessionOptions` has no `systemPrompt` field -- determine actual mechanism
4. **Cost extraction**: Inspect `ContextUsage` shape -- does it provide inputTokens, outputTokens, costUsd?
5. **filesChanged extraction**: How does the session track file modifications?
6. **Abort mechanism**: Confirm `session.context.abort()` or find alternative
7. **Error types**: Catalog PI SDK error types for mapping to `AgentDispatchError` variants -- consider adding `rateLimitExceeded`, `contextWindowExceeded`, `authenticationFailed` if justified
8. **Integration test scope**: Define boundary -- ENV-gated, no real LLM calls in CI, mock PI session for contract tests

Findings may revise the PiAgentDispatchAdapter design. Port + InMemoryAdapter + contract tests are stable.

## Non-Goals

- Domain routing (file paths -> skills) -- S07
- Concurrency orchestration / wave sequencing -- S07
- Stale claim detection -- S07/S09
- Worktree creation/resolution -- S04
- workingDirectory is a pre-resolved string; caller resolves worktree path

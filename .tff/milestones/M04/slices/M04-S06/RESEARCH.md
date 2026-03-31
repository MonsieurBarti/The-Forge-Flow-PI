# M04-S06 Research: Agent Status Protocol

## Findings

### 1. PI Adapter Output Capture

`session.getLastAssistantText()` returns only the **last** assistant message. Multi-turn sessions lose earlier messages. Implication: the `<!-- TFF_STATUS_REPORT -->` block must appear in the agent's **final** message. The prompt fragment must instruct agents to emit the status report at the very end of their last response.

### 2. Prompt Injection Point

Current flow (`pi-agent-dispatch.adapter.ts:107-109`):
```
const prompt = config.systemPrompt
  ? `${config.systemPrompt}\n\n---\n\n${config.taskPrompt}`
  : config.taskPrompt;
```

`AGENT_STATUS_PROMPT` should be appended to `config.systemPrompt` before concatenation. The adapter becomes the single injection point — callers don't need to know about the status protocol.

### 3. Error Path Analysis

Two distinct error paths in the PI adapter:

| Path | Current behavior | S06 change |
|---|---|---|
| `stateError` (session ran but errored) | Returns `err(AgentDispatchError)` | Parse output anyway — agent may have emitted a status report before the error. If parse fails, build BLOCKED result. |
| `catch` (session creation/throw) | Returns `err(AgentDispatchError)` | No output to parse. Build BLOCKED result directly with error message. |

**Key insight**: The `stateError` path currently returns an `err()` Result, meaning the caller never sees an `AgentResult`. Post-S06, this path should return an `ok()` Result with `status: BLOCKED` instead, so the caller gets a structured status even on failure. The `err()` path should be reserved for truly unrecoverable infrastructure failures (session creation failed, no output at all).

This is a behavior change. The contract spec's `givenFailure` test currently expects `isErr(result)`. Post-S06, the contract needs a `givenAgentBlocked` that returns `ok()` with BLOCKED status, vs `givenInfraFailure` that returns `err()`.

### 4. Contract Test Configurator Impact

The `TestConfigurator` interface needs updating:
- `givenSuccess(taskId)` → `givenResult(taskId, status)` — pre-configure any status
- `givenFailure(taskId, error)` stays — for infrastructure-level errors
- Add `givenBlocked(taskId, error)` — for agent-level BLOCKED (returns `ok()` with BLOCKED status)

### 5. Builder Transition

Current builder defaults: `_success = true`. All 14 call sites use either the default or `withSuccess()`/`withFailure()`.

Migration path:
- Replace `_success` with `_status: AgentStatus = "DONE"`
- Replace `_error?: string` semantics: now populated for BLOCKED/NEEDS_CONTEXT
- Add `_concerns` and `_selfReview` with sensible defaults
- `asDone()` = default (no-op convenience)
- `asDoneWithConcerns(concerns)` = sets status + concerns
- `asBlocked(error)` = sets status + error (replaces `withFailure`)
- `asNeedsContext(error)` = sets status + error

### 6. Consumer Audit (exhaustive)

Files referencing `AgentResult.success` or derived `.success`:

| File | Line | Usage | Migration |
|---|---|---|---|
| `agent-result.schema.ts` | 18 | Schema definition | Remove field |
| `agent-result.builder.ts` | 9,30,55 | Builder default + methods | Replace with status |
| `agent-result.builder.spec.ts` | 9,14 | Builder assertions | Assert status |
| `agent-result.schema.spec.ts` | 78 | Schema validation | Assert status |
| `pi-agent-dispatch.adapter.ts` | 128 | Hard-coded `success: true` | Replace with parsed status |
| `agent-dispatch.contract.spec.ts` | 59 | Asserts `result.data.success` | Assert `result.data.status` |
| `task-execution-completed.event.spec.ts` | 43 | Asserts `event.agentResult.success` | Assert status |
| `record-task-metrics.use-case.ts` | 33 | Maps to `TaskMetrics.success` | Use `isSuccessfulStatus()` |
| `record-task-metrics.use-case.spec.ts` | 61,89 | Asserts `metrics.success` | Still boolean (TaskMetrics unchanged) |
| `task-metrics.builder.spec.ts` | 24 | Asserts `metrics.success` | Still boolean |
| `aggregate-metrics.use-case.spec.ts` | 56 | Asserts `successCount` | Still uses TaskMetrics.success |

`TaskMetrics.success: z.boolean()` stays — it's a persisted metric. Only the mapping in `RecordTaskMetricsUseCase` changes.

### 7. Self-Review Default

For the builder, a sensible default self-review (used in tests):
```
{
  dimensions: [
    { dimension: "completeness", passed: true },
    { dimension: "quality", passed: true },
    { dimension: "discipline", passed: true },
    { dimension: "verification", passed: true },
  ],
  overallConfidence: "high",
}
```

This avoids test bloat — most tests don't care about self-review details.

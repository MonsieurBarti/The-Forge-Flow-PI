# M04-S09: Async Overseer / Watchdog

## Problem

During wave-based execution, agents can become stuck (infinite loops, stagnation, runaway tokens). Current system only detects stale claims between waves (30 min hardcoded). A stuck agent within a wave blocks all sibling tasks from completing via `Promise.allSettled`, wasting time and cost. Need: lightweight, real-time monitor that detects stuck agents, aborts them, retries with error context, and escalates when retries exhausted.

## Approach

**OverseerPort** — hexagonal port with composable detection strategies + **RetryPolicy** for inter-attempt decisions. Follows existing patterns (cf. `OutputGuardrailPort`).

Two-layer design:
- **OverseerPort**: monitors _running_ agents in real-time (timeout detection via timers)
- **RetryPolicy**: decides _between_ dispatch attempts whether to retry (retry loop detection via in-memory error accumulation)

This separation exists because journal entries for task failures are written after dispatch settles — the overseer cannot detect retry loops during dispatch. RetryPolicy operates synchronously between attempts.

Trade-offs considered:
- ~~Wrapper pattern~~: couples monitoring to dispatch, harder to extend
- ~~Inline in use case~~: bloats `ExecuteSliceUseCase`, mixes orchestration with monitoring
- ~~Single OverseerPort for both~~: journal timing makes intra-dispatch retry-loop detection impossible
- **OverseerPort + RetryPolicy** ✓: clean separation of real-time monitoring vs inter-attempt decisions

## Architecture

### OverseerPort (domain)

```
abstract class OverseerPort:
  monitor(ctx: OverseerContext): Promise<OverseerVerdict>  — resolves when a strategy triggers
  stop(taskId: string): Promise<void>                      — cancel monitors for one task
  stopAll(): Promise<void>                                 — teardown all monitors (wave end)
```

`monitor()` returns a promise that resolves with a verdict when any strategy triggers. The use case races `dispatch()` against `monitor()`. If the overseer wins, the use case calls `agentDispatch.abort()`. This keeps orchestration in the application layer.

`stop(taskId)` cancels monitors for a specific task (needed for parallel waves where siblings are still running). `stopAll()` is for wave-end cleanup.

### RetryPolicy (domain)

```
abstract class RetryPolicy:
  shouldRetry(taskId: string, error: OverseerError | AgentDispatchError, attempt: number): RetryDecision
  recordFailure(taskId: string, errorSignature: string): void
  reset(taskId: string): void
```

```
RetryDecision: { retry: boolean, reason: string }
```

In-memory, synchronous. Checks:
1. `attempt < maxRetries`
2. Error signatures for last N failures — if all identical, don't retry (same error will recur)

### OverseerContext

```
{ taskId, sliceId, complexityTier, dispatchTimestamp }
```

No file paths, no port references in domain context. The adapter receives dependencies at construction time.

### OverseerVerdict

```
{ strategy: string, reason: string }
```

Strategies detect only. Recovery decisions (abort/retry/escalate) are made by the use case.

### Detection Strategies (composable)

**TimeoutStrategy** — timer-based, per-tier:
- `setTimeout` on `monitor()`, `clearTimeout` on `stop(taskId)`
- Defaults: S=5min, F-lite=15min, F-full=30min
- Verdict: `{ strategy: 'timeout', reason: 'Task exceeded {tier} timeout of {ms}ms' }`

**CostLimitStrategy** — DEFERRED: PI SDK only exposes cost in `AgentResult` after completion. Real-time cost monitoring requires SDK changes.

### ComposableOverseerAdapter (infra)

- Accepts `OverseerStrategy[]`, maintains per-task monitor map
- `monitor(ctx)`: starts all strategies for task, returns `Promise.race` of strategy promises
- `stop(taskId)`: cancels all strategies for that task, rejects its monitor promise (caught silently)
- `stopAll()`: calls `stop()` for all active tasks

### InMemoryRetryPolicyAdapter (infra)

- In-memory `Map<taskId, errorSignature[]>` for test and production
- `recordFailure()`: appends normalized error signature
- `shouldRetry()`: checks attempt count + signature similarity
- Error signature: `hash(errorCode)` — stable across minor message variations

### Wave Dispatch Integration

The existing `Promise.allSettled` wave loop is restructured. Each task dispatch is wrapped in a retry-aware function:

```
// Per-task dispatch with overseer + retry
async executeTaskWithOverseer(task, config, maxRetries):
  for attempt = 0 to maxRetries:
    // Race dispatch against overseer
    monitorPromise = overseer.monitor({ taskId, sliceId, complexityTier, dispatchTimestamp: now() })
    dispatchPromise = agentDispatch.dispatch(config)

    raceResult = await Promise.race([
      dispatchPromise.then(r => ({ type: 'completed', value: r })),
      monitorPromise.then(v => ({ type: 'intervention', verdict: v }))
    ])

    if raceResult.type === 'completed':
      overseer.stop(task.id)
      return raceResult.value  // Result<AgentResult, AgentDispatchError>

    if raceResult.type === 'intervention':
      agentDispatch.abort(task.id)
      journal(overseer-intervention, action: 'aborted', attempt)

      // Check retry policy
      retryPolicy.recordFailure(task.id, hashError(raceResult.verdict))
      decision = retryPolicy.shouldRetry(task.id, raceResult.verdict, attempt)

      if !decision.retry:
        journal(overseer-intervention, action: 'escalated', attempt)
        return Err(OverseerError.timeout(task.id, raceResult.verdict.reason))

      // Retry with enriched prompt
      journal(overseer-intervention, action: 'retrying', attempt)
      config = enrichPrompt(config, raceResult.verdict)
      continue

  // Exhausted retries (should not reach here due to decision check above)
  return Err(OverseerError.timeout(task.id, 'max retries exhausted'))

// Wave level (replaces existing Promise.allSettled block):
perTaskPromises = waveTasks.map((task, i) =>
  executeTaskWithOverseer(task, configs[i], maxRetries)
)
settled = await Promise.allSettled(perTaskPromises)

// Post-settlement: guardrail validation, checkpoint saves — UNCHANGED
```

Key properties:
- Each task's retry loop is self-contained within `executeTaskWithOverseer`
- `Promise.allSettled` at wave level waits for all tasks (including retries) to settle
- Post-settlement guardrail checks and checkpoint saves work exactly as before
- A retrying task does not block sibling tasks (they settle independently)
- `overseer.stop(taskId)` only cancels that task's monitors, not siblings'

### Handling dispatch failures (non-timeout)

When dispatch returns `Err(AgentDispatchError)` (agent failed, not timed out):

```
if raceResult.type === 'completed' && !raceResult.value.ok:
  overseer.stop(task.id)
  // Agent failed normally — check retry policy for retry loops
  retryPolicy.recordFailure(task.id, hashError(raceResult.value.error))
  decision = retryPolicy.shouldRetry(task.id, raceResult.value.error, attempt)

  if decision.retry:
    journal(overseer-intervention, action: 'retrying', attempt)
    config = enrichPrompt(config, raceResult.value.error)
    continue
  else:
    return raceResult.value  // propagate the failure
```

This is how RetryLoopStrategy's job is accomplished: between dispatch attempts, the RetryPolicy checks error signature similarity. If 3 identical errors → stop retrying, escalate immediately (don't burn maxRetries).

### Stale-claim detection

Retained as a separate pre-dispatch check. Stale claims (from previous interrupted runs) and stuck agents (current run) are distinct failure modes. The overseer handles the latter; stale-claim detection handles the former.

## Domain Model

### OverseerConfigSchema

```
enabled: boolean
timeouts: { S: number, 'F-lite': number, 'F-full': number }  // ms
retryLoop: { threshold: number }  // N identical errors before giving up
maxRetries: number  // from settings autonomy.max-retries
```

### New journal entry type

```
'overseer-intervention': {
  taskId, strategy, reason,
  action: 'aborted' | 'retrying' | 'escalated',
  retryCount
}
```

Added to `JournalEntrySchema` discriminated union. Downstream impact: journal parsing, replay, exhaustive matches on entry types — all must be updated.

### New domain errors

```
OverseerError: TIMEOUT | RETRY_LOOP | ABORT_FAILED
```

### Settings addition (autonomy section)

```yaml
overseer:
  enabled: true
  timeouts:
    S: 300000       # 5 min
    F-lite: 900000  # 15 min
    F-full: 1800000 # 30 min
  retry-loop:
    threshold: 3    # identical errors before giving up
```

Extends `AutonomyConfigSchema` with `overseer: OverseerConfigSchema`. Extends `SETTINGS_DEFAULTS`.

## Recovery Flow

1. **Abort**: use case calls `agentDispatch.abort(taskId)` → journal `overseer-intervention` w/ action `'aborted'`
2. **Cleanup**: use existing `gitPort.restoreWorktree(workingDirectory)` for partial artifacts. Note: `restoreWorktree` runs `git restore .` which only reverts tracked files. Untracked files from aborted agents may persist — acceptable for worktree-based execution (worktree is disposable).
3. **Retry decision**: `retryPolicy.shouldRetry(taskId, error, attempt)` — checks attempt count + error signature similarity
4. **Retry**: re-dispatch with enriched prompt (`"Previous attempt failed: {reason}. Avoid: {error_signature}"`), journal action `'retrying'`, restart monitoring
5. **Escalate**: retries exhausted OR retry loop detected → journal action `'escalated'` → return `OverseerError` → wave fails (existing fail-fast)

Retry budget: `autonomy.max-retries` (currently 2). Per-task, not per-wave.

## Edge Cases

- **Simultaneous timeouts**: N tasks time out at once → N concurrent `abort()` calls. Each abort is independent (PiAgentDispatchAdapter maintains per-task sessions). Safe.
- **Photo finish** (dispatch completes same tick as timeout): `Promise.race` picks first microtask-queued. If dispatch wins, intervention verdict is discarded (not journaled). If timeout wins, dispatch result is lost → abort + retry.
- **Settings hot-reload**: `overseer.enabled` is read once at use case start. Mid-execution changes have no effect. Documented behavior.
- **Journal read failure**: RetryLoopStrategy is now in-memory (RetryPolicy), so journal read failures don't affect detection. Journal writes for audit may fail — swallowed with warning log.

## Acceptance Criteria

1. Stuck agents killed after configurable timeout (per tier)
2. Infinite retry loops detected via error signature matching and broken (escalated without burning remaining retries)
3. Structured journal entry (`overseer-intervention`) per intervention event
4. Configurable retries w/ error context injection before escalation
5. Overseer opt-out via `overseer.enabled: false` (falls back to current behavior — no monitoring)
6. Verified: stale-claim detection not regressed by overseer integration

## Non-Goals

- Real-time cost monitoring (PI SDK limitation — deferred, post-hoc via guardrails)
- Real-time streaming progress from agents (PI SDK limitation)
- Agent self-healing (agents don't know they're being watched)
- Cross-wave monitoring (each wave is independent)
- UI/dashboard for monitoring (CLI-only project)

## Research Items

- PI SDK `abort()` behavior: clean termination vs partial artifacts → determines whether additional cleanup needed beyond `restoreWorktree`. BLOCKING: must resolve before planning to confirm recovery flow step 2.

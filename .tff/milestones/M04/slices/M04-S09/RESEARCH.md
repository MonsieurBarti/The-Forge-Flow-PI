# M04-S09: Research — Async Overseer / Watchdog

## R1: PI SDK abort() Behavior (BLOCKING)

**Verdict: Clean abort — no process leaks, partial worktree artifacts possible.**

### How it works

`PiAgentDispatchAdapter.abort(taskId)` (pi-agent-dispatch.adapter.ts:202-209):
1. Looks up `AgentSession` from `running` Map
2. Calls `session.abort()` — PI SDK cancels all in-flight ops via `AbortController`:
   - LLM requests (`_compactionAbortController`, `_retryAbortController`)
   - Bash commands (`_bashAbortController`)
   - Branch summarization (`_branchSummaryAbortController`)
3. Removes session from `running` Map
4. Calls `session.dispose()` — cleans event listeners/resources
5. Safe no-op if taskId unknown

### Subprocess termination

PI SDK bash-executor uses `AbortSignal` for cancellation. On abort:
- Running bash process receives signal → terminated
- Result gets `cancelled: true`, exit code `undefined`
- Process group killed via standard Node.js signal propagation

### Worktree state after abort

- **Tracked file changes**: cleaned by `gitPort.restoreWorktree()` (`git restore .`)
- **Untracked files**: PERSIST — `git restore` does not touch untracked files
- **No `git clean` in codebase**: `GitPort` has no method to remove untracked files

**Decision**: Acceptable. Worktrees are disposable (created per-slice, deleted on ship). Untracked files from aborted agents don't affect subsequent retries because the worktree state is restored for tracked changes, and new agent attempts write their own files. For security-sensitive scenarios, the guardrail system already validates output post-dispatch.

## R2: Integration Points

### ExecuteSliceUseCase deps (execute-slice.use-case.ts:44-58)

Current deps interface has 13 dependencies. Add:
- `readonly overseer: OverseerPort`
- `readonly retryPolicy: RetryPolicy`

### Settings schema (project-settings.schemas.ts:57-60)

`BaseAutonomyConfigSchema` has `mode` + `maxRetries`. Add `overseer` sub-object following same pattern as `GuardrailsConfigSchema` (lines 96-113): enabled flag + nested config with defaults.

ENV_VAR_MAP (lines 196-203) needs: `TFF_OVERSEER_ENABLED` → `["autonomy", "overseer", "enabled"]`

### Journal entry union (journal-entry.schemas.ts:86-95)

Add `OverseerInterventionEntrySchema` to discriminated union. Downstream consumers:
- `JournalEntryBuilder` (journal-entry.builder.ts:12-158): add `buildOverseerIntervention()` — needed
- `ReplayJournalUseCase` (replay-journal.use-case.ts:46-54): uses selective `if` on `entry.type`, NOT exhaustive switch — safe, ignores unknown types
- `JournalEventHandler` (journal-event-handler.ts:14-79): event-driven, subscribes to specific events — safe, unaffected
- `JsonlJournalRepository` / `InMemoryJournalRepository`: parse via schema union, need new member added — additive

### Error pattern (execution/domain/errors/)

Follow `AgentDispatchError` pattern: extends `BaseDomainError`, readonly `code`, private constructor, static factory methods. E.g., `OverseerError.timeout(taskId, reason)`, `OverseerError.retryLoop(taskId, reason)`, `OverseerError.abortFailed(taskId, reason)`.

### Port pattern (execution/domain/ports/)

Follow `OutputGuardrailPort` pattern: abstract class, single method returning `Promise<Result<T, E>>`. For OverseerPort: `monitor()` returns `Promise<OverseerVerdict>` (not Result — it resolves when triggered, rejects on cancellation).

### Composition root (cli/extension.ts:33-75)

Wire after guardrail adapter creation. Load config from settings, construct strategies, build `ComposableOverseerAdapter` + `DefaultRetryPolicy`.

### InMemoryAgentDispatchAdapter.abort() (in-memory-agent-dispatch.adapter.ts:61-68)

Clears pending timer, removes from running map, resolves dispatch promise with `Err(AgentDispatchError.sessionAborted(taskId))`. Tests can simulate abort scenarios without real agents. Contract tests verify abort behavior at agent-dispatch.contract.spec.ts:117-150.

## R3: Existing Wave Dispatch Structure

The dispatch loop (execute-slice.use-case.ts:193-196) wraps `configs.map(c => agentDispatch.dispatch(c))` in `Promise.allSettled`. Post-settlement: guardrail validation (lines 198-243), result processing (lines 245-340), checkpoint saves.

The `executeTaskWithOverseer()` function from the spec replaces the raw `dispatch()` call inside the `.map()`. Everything else (guardrails, checkpoints, result processing) stays at wave level, untouched.

## R4: Files Affected

### New files (6)
1. `execution/domain/ports/overseer.port.ts` — OverseerPort abstract class
2. `execution/domain/retry-policy.port.ts` — RetryPolicy abstract class
3. `execution/domain/errors/overseer.error.ts` — OverseerError
4. `execution/domain/overseer.schemas.ts` — OverseerVerdict, OverseerContext, OverseerConfig schemas
5. `execution/infrastructure/composable-overseer.adapter.ts` — ComposableOverseerAdapter + TimeoutStrategy
6. `execution/infrastructure/in-memory-overseer.adapter.ts` — InMemoryOverseerAdapter for tests

### Modified files (6)
1. `execution/domain/journal-entry.schemas.ts` — add OverseerInterventionEntry
2. `execution/domain/journal-entry.builder.ts` — add buildOverseerIntervention()
3. `execution/application/execute-slice.use-case.ts` — add overseer + retryPolicy deps, restructure dispatch loop
4. `settings/domain/project-settings.schemas.ts` — add OverseerConfigSchema to settings
5. `execution/index.ts` — export new types
6. `cli/extension.ts` — wire overseer in composition root

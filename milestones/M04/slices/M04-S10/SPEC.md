# M04-S10: Execute/Pause/Resume Commands

## Problem

The execution engine (S07) dispatches tasks wave-by-wave with checkpointing. The journal (S02) enables replay for crash recovery. But there are no commands to invoke execution, intentionally pause mid-run, or resume from a checkpoint. The workflow phase transitions for pause/resume exist in the state machine but have no triggers. Users cannot start execution from the CLI, gracefully stop between waves, or resume after a pause or crash with automatic journal validation.

## Requirement Coverage

- **R10**: `/tff:execute`, `/tff:pause`, `/tff:resume` commands
- **R05**: Crash recovery — journal replay on resume, checkpoint consistency validation

## Approach

**ExecutionSession aggregate + ExecutionCoordinator use case**. Clean hexagonal split: ExecutionSession is a pure domain state machine that owns the AbortController for pause signaling. ExecutionCoordinator orchestrates the lifecycle by composing existing use cases (ExecuteSliceUseCase, ReplayJournalUseCase). ExecuteSliceUseCase gains only an optional `AbortSignal` param — checked between waves.

Trade-offs considered:
- ~~Session + modified UseCase~~: couples session lifecycle into existing use case
- ~~AbortController + no entity~~: pause state is implicit, not a domain concept
- **Coordinator + Session** ✓: clean separation, use case untouched except optional signal

## Architecture

```
Commands (PI extension tools)
    │
    ▼
ExecutionCoordinator (application use case)
    ├── ExecutionSession (domain aggregate — lifecycle state machine)
    ├── ExecuteSliceUseCase (existing — gains AbortSignal param)
    ├── ReplayJournalUseCase (existing — validates resume consistency)
    ├── CheckpointRepository (existing)
    ├── JournalRepository (existing)
    └── PhaseTransitionPort (existing — triggers workflow phase changes)
```

### Command Flow

| Command | Flow |
|---|---|
| `/tff:execute` | Create session → `session.start()` → phase → executing → register SIGINT handler → `ExecuteSliceUseCase.execute()` → on completion: `session.complete()` or `session.fail()` |
| `/tff:pause` | Post-crash recovery: load session from repo → if running (orphaned from crash) → `session.confirmPause()` → phase → paused. If no active execution, transitions state to paused for later resume. |
| `/tff:resume` | Load session → `ReplayJournalUseCase` validates → `session.resume()` → phase → executing → `ExecuteSliceUseCase.execute()` with checkpoint resume → complete/fail |

### Pause Model: Between-Wave via PauseSignalPort

The PI SDK serializes tool calls — the AI cannot call `/tff:pause` while `/tff:execute` is running. Pause is triggered via an abstracted signal source:

**PauseSignalPort** (domain port):
```typescript
abstract class PauseSignalPort {
  abstract register(callback: () => void): void   // register pause trigger
  abstract dispose(): void                          // cleanup (finally block)
}
```

**Adapters:**
- `ProcessSignalPauseAdapter` — wraps `process.on('SIGINT', callback)`, removes on `dispose()`. Used in production.
- `InMemoryPauseSignalAdapter` — exposes `triggerPause()` for tests. No process signals needed.

**Flow:**
1. Coordinator registers pause callback via `pauseSignal.register(() => session.requestPause())`
2. `requestPause()` triggers `AbortController.abort()`
3. Between waves, ExecuteSliceUseCase checks `signal.aborted` → returns `aborted: true`
4. Coordinator detects `isPauseRequested` → `session.confirmPause()` → save → phase → paused
5. Tool returns with acknowledgement (wavesCompleted, totalWaves, status: 'paused')
6. `pauseSignal.dispose()` called in `finally` block (cleanup, even on errors)

**Why a port**: SIGINT propagation inside PI SDK tool handlers is unverified. The port abstraction allows swapping to a file-sentinel adapter if SIGINT doesn't propagate. Also enables deterministic unit testing without sending real process signals.

For **crash recovery** (process killed before clean pause): the checkpoint is already saved after each wave. The `/tff:pause` tool transitions an orphaned running session to paused. The `/tff:resume` tool handles the "no session but checkpoint exists" case.

The `/tff:pause` tool is a **state reconciliation** command, not a concurrent signal. It normalizes state after interruptions so `/tff:resume` can proceed.

## Domain Model

### ExecutionSession Aggregate

State machine:
```
created ──start()──▶ running ──confirmPause()──▶ paused ──resume()──▶ running
                        │                                                │
                        ├──complete()──▶ completed                       ├──complete()──▶ completed
                        └──fail()──────▶ failed                          └──fail()──────▶ failed
```

Props schema:
```typescript
ExecutionSessionPropsSchema = z.object({
  id: z.string().uuid(),
  sliceId: z.string(),
  milestoneId: z.string(),
  status: z.enum(['created', 'running', 'paused', 'completed', 'failed']),
  resumeCount: z.number().int().min(0),
  failureReason: z.string().optional(),
  startedAt: z.date().optional(),
  pausedAt: z.date().optional(),
  completedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
```

API:
```typescript
class ExecutionSession extends AggregateRoot<ExecutionSessionProps> {
  static createNew(params: { id, sliceId, milestoneId, now }): ExecutionSession
  static reconstitute(props: ExecutionSessionProps): ExecutionSession

  start(now: Date): void                    // created → running, creates AbortController
  requestPause(): void                      // triggers AbortController.abort() (running only)
  confirmPause(now: Date): void             // running → paused
  resume(now: Date): void                   // paused → running, fresh AbortController, ++resumeCount
  complete(now: Date): void                 // running → completed
  fail(reason: string, now: Date): void     // running → failed

  get signal(): AbortSignal                 // exposes AbortController.signal
  get isPauseRequested(): boolean
  get canResume(): boolean                  // status === 'paused'
}
```

AbortController lifecycle:
- `start()` → new `AbortController()`
- `requestPause()` → `controller.abort()`
- `resume()` → new `AbortController()` (fresh signal)
- `reconstitute()` → new `AbortController()` (signal is transient, not persisted)

### Domain Events

| Transition | Event |
|---|---|
| `start()` | `ExecutionStartedEvent` |
| `confirmPause()` | `ExecutionPausedEvent` |
| `resume()` | `ExecutionResumedEvent` |
| `complete()` | `ExecutionCompletedEvent` |
| `fail()` | `ExecutionFailedEvent` |

Events pushed to internal `events` array, pulled by coordinator via `session.pullEvents()`, published to EventBus. JournalEventHandler subscribes to write corresponding `execution-lifecycle` journal entries.

### Journal Entry: `execution-lifecycle`

```typescript
ExecutionLifecycleEntry = JournalEntryBase & {
  type: 'execution-lifecycle'
  sessionId: string
  action: 'started' | 'paused' | 'resumed' | 'completed' | 'failed'
  resumeCount: number
  failureReason?: string           // only on 'failed'
  wavesCompleted?: number          // on 'paused', 'completed', 'failed'
  totalWaves?: number              // on 'paused', 'completed', 'failed'
}
```

Added to `JournalEntrySchema` discriminated union. Follows `GuardrailViolationEntry` pattern (single type, action discriminator).

Note: `execution-lifecycle` entries are **audit-only** — `ReplayJournalUseCase` does not consume them. Replay validates execution progress via `task-completed` and `checkpoint-saved` entries. Session lifecycle is validated by the coordinator loading session state, not by replaying lifecycle entries.

### Persistence: Embedded in CHECKPOINT.md

No separate SESSION.md. ExecutionSession data persisted in CHECKPOINT.md using a second HTML-comment block:

```markdown
# Checkpoint — M04-S01

Status: running | Wave: 2/4 | Tasks: 5/8 completed
Session: running | Resumes: 0

<!-- checkpoint-data: {"id":"...","sliceId":"...","currentWaveIndex":2,...} -->
<!-- session-data: {"id":"...","sliceId":"...","status":"running","resumeCount":0,...} -->
```

`ExecutionSessionRepositoryPort`:
```typescript
abstract class ExecutionSessionRepositoryPort {
  abstract save(session: ExecutionSession): Promise<Result<void, PersistenceError>>
  abstract findBySliceId(sliceId: string): Promise<Result<ExecutionSession | null, PersistenceError>>
  abstract delete(sliceId: string): Promise<Result<void, PersistenceError>>
}
```

Adapters:
- **MarkdownExecutionSessionAdapter**: reads/writes `<!-- session-data: {...} -->` in CHECKPOINT.md. Uses read-modify-write: reads file, replaces only the session comment block, writes back.
- **InMemoryExecutionSessionAdapter**: `Map<sliceId, ExecutionSession>` for tests

**File coordination**: The existing `MarkdownCheckpointRepository` does a full render (`renderMarkdown()`) that would **destroy** the session block. Fix: modify its `save()` to extract and preserve any `<!-- session-data: ... -->` block before re-rendering, then append it after the checkpoint block. This makes the checkpoint adapter a collaborative writer. Both adapters use atomic write (write tmp → rename) for crash safety. Writes are sequential (never concurrent within a single execution flow), so no locking needed.

**Integration test required**: a test that saves checkpoint, then saves session, then saves checkpoint again — verifying both blocks survive all three writes.

## Application Layer

### ExecutionCoordinator Use Case

```typescript
interface ExecutionCoordinatorDeps {
  sessionRepository: ExecutionSessionRepositoryPort
  pauseSignal: PauseSignalPort
  executeSlice: ExecuteSliceUseCase
  replayJournal: ReplayJournalUseCase
  checkpointRepository: CheckpointRepositoryPort
  phaseTransition: PhaseTransitionPort
  eventBus: EventBusPort
  dateProvider: DateProviderPort
  logger: LoggerPort
}
```

The coordinator maintains references to the running execution:

```typescript
class ExecutionCoordinator {
  private runningExecution: Promise<Result<ExecuteSliceResult, ExecutionError>> | null = null
  private activeSession: ExecutionSession | null = null
}
```

**`startExecution(input)`**:
1. Validate no active session: reject if `paused` (error: "use resume"), reject if `running` (error: "already running"). Allow if `failed`, `completed`, or no session exists.
2. Load or create `ExecutionSession` → `session.start(now)`
3. Save session, publish events
4. Trigger phase transition → `executing`
5. Store reference: `this.runningExecution = executeSlice.execute({ ...input, signal: session.signal })`
6. Await result
7. If `result.aborted && session.isPauseRequested`: `session.confirmPause(now)` → save → phase → `paused`
8. If `result.ok && !result.aborted`: `session.complete(now)` → save → phase transition
9. If `!result.ok`: `session.fail(reason, now)` → save

**`pauseExecution(sliceId)`** (called within SIGINT handler or post-crash):
1. If `activeSession` exists in memory and is running (SIGINT path):
   - `activeSession.requestPause()` — triggers AbortController.abort()
   - The running `startExecution` flow handles confirmation on return
2. If no active in-memory session (post-crash `/tff:pause` tool path):
   - Load session from repository
   - If status is `running` (orphaned): `session.confirmPause(now)` → save → phase → paused
   - If status is `paused`: no-op (already paused)
   - Otherwise: error

**Resume error handling**: If `ReplayJournalUseCase` returns `err(JournalReplayError)`, the coordinator transitions session to `failed` with reason from the replay error and returns the error to the caller. The user must investigate the journal inconsistency before retrying.

**`resumeExecution(sliceId)`**:
1. Load session from repository → assert `status === 'paused'`
2. Load checkpoint → call `ReplayJournalUseCase` to validate consistency
3. `session.resume(now)` → fresh AbortController
4. Save session, publish events
5. Trigger phase transition → `executing`
6. Call `ExecuteSliceUseCase.execute({ ...input, signal: session.signal })`
7. Same completion/failure/abort handling as `startExecution`

### Crash Recovery (AC9)

When `resumeExecution` is called but no session exists (crash interrupted before session was persisted): coordinator creates a new session from checkpoint state, sets it to `paused`, then immediately resumes. The checkpoint is the source of truth for execution progress.

## ExecuteSliceUseCase Modification

Minimal change — `AbortSignal` added as a **separate method parameter** (not in the Zod schema, since `AbortSignal` cannot be serialized to JSON Schema for `createZodTool`):

**Method signature change:**
```typescript
// Before:
execute(input: ExecuteSliceInput): Promise<Result<ExecuteSliceResult, ExecutionError>>

// After:
execute(input: ExecuteSliceInput, signal?: AbortSignal): Promise<Result<ExecuteSliceResult, ExecutionError>>
```

The Zod `ExecuteSliceInputSchema` is **unchanged** — signal is not part of the validated schema.

**Wave loop** (after `advanceWave` + checkpoint save, before starting next wave):
```typescript
if (signal?.aborted) {
  return ok({
    sliceId: input.sliceId,
    completedTasks,
    failedTasks,
    skippedTasks,
    wavesCompleted,
    totalWaves: waves.length,
    aborted: true,
  });
}
```

Existing `aborted: true` field now covers both "wave failed" and "pause requested". The coordinator distinguishes via `session.isPauseRequested`.

## Commands (PI Extension)

Three tools in `execution.extension.ts`:

### `tff_execute_slice`

```typescript
schema: z.object({
  sliceId: z.string().describe('Slice ID (e.g., M04-S01)'),
  milestoneId: z.string().describe('Milestone ID (e.g., M04)'),
})
```

### `tff_pause_execution`

Post-crash state reconciliation. Transitions an orphaned `running` session to `paused`.

```typescript
schema: z.object({
  sliceId: z.string().describe('Slice ID to pause'),
})
```

### `tff_resume_execution`

```typescript
schema: z.object({
  sliceId: z.string().describe('Slice ID to resume'),
})
```

Extension deps:
```typescript
interface ExecutionExtensionDeps {
  sessionRepository: ExecutionSessionRepositoryPort
  pauseSignal: PauseSignalPort
  checkpointRepository: CheckpointRepositoryPort
  journalRepository: JournalRepositoryPort
  taskRepository: TaskRepositoryPort
  waveDetection: WaveDetectionPort
  agentDispatch: AgentDispatchPort
  worktree: WorktreePort
  guardrail: OutputGuardrailPort
  overseer: OverseerPort
  retryPolicy: RetryPolicy
  overseerConfig: OverseerConfig
  phaseTransition: PhaseTransitionPort
  metricsRepository: MetricsRepositoryPort
  eventBus: EventBusPort
  dateProvider: DateProviderPort
  gitPort: GitPort
  logger: LoggerPort
  templateContent: string
}
```

The `ExecutionCoordinator` is instantiated once in `registerExecutionExtension()` and shared across the three tools (singleton within the extension).

## File Inventory

### New Files

| File | Purpose |
|---|---|
| `execution/domain/execution-session.aggregate.ts` | ExecutionSession state machine |
| `execution/domain/execution-session.aggregate.spec.ts` | State machine tests |
| `execution/domain/execution-session.schemas.ts` | Props + status schemas |
| `execution/domain/execution-session.schemas.spec.ts` | Schema validation tests |
| `execution/domain/ports/execution-session-repository.port.ts` | Repository port |
| `execution/domain/ports/pause-signal.port.ts` | Pause signal abstraction |
| `execution/infrastructure/process-signal-pause.adapter.ts` | SIGINT-based pause adapter |
| `execution/infrastructure/in-memory-pause-signal.adapter.ts` | Test double for pause signal |
| `execution/domain/events/execution-started.event.ts` | Event |
| `execution/domain/events/execution-paused.event.ts` | Event |
| `execution/domain/events/execution-resumed.event.ts` | Event |
| `execution/domain/events/execution-completed.event.ts` | Event |
| `execution/domain/events/execution-failed.event.ts` | Event |
| `execution/infrastructure/markdown-execution-session.adapter.ts` | CHECKPOINT.md session persistence |
| `execution/infrastructure/markdown-execution-session.adapter.spec.ts` | Persistence tests |
| `execution/infrastructure/in-memory-execution-session.adapter.ts` | Test double |
| `execution/application/execution-coordinator.use-case.ts` | Coordinator orchestration |
| `execution/application/execution-coordinator.use-case.spec.ts` | Coordinator tests |
| `execution/application/execution-coordinator.schemas.ts` | Input/output schemas |
| `execution/infrastructure/pi/execution.extension.ts` | PI extension tool registration |
| `execution/infrastructure/pi/execute-slice.tool.ts` | Execute tool |
| `execution/infrastructure/pi/pause-execution.tool.ts` | Pause tool |
| `execution/infrastructure/pi/resume-execution.tool.ts` | Resume tool |

### Modified Files

| File | Change |
|---|---|
| `execution/application/execute-slice.use-case.ts` | Add `signal?: AbortSignal` param, check between waves (~5 lines) |
| `execution/application/execute-slice.use-case.spec.ts` | Add test for signal-based abort |
| `execution/domain/journal-entry.schemas.ts` | Add `execution-lifecycle` entry type |
| `execution/application/journal-event-handler.ts` | Subscribe to 5 execution events |
| `execution/infrastructure/markdown-checkpoint.repository.ts` | Preserve `<!-- session-data -->` block during save (collaborative writer) |
| `execution/infrastructure/markdown-checkpoint.repository.spec.ts` | Add file-coordination integration test |
| `execution/index.ts` | Export new types |
| `cli/extension.ts` | Wire execution extension deps |

## Acceptance Criteria

1. `/tff:execute` dispatches tasks wave-by-wave with checkpointing
2. `/tff:pause` saves state and can resume from exact point
3. `/tff:resume` skips completed work
4. ExecutionSession state machine enforces valid transitions
5. Pause waits for current wave to complete before acknowledging
6. Resume validates journal consistency before continuing
7. `execution-lifecycle` journal entries written for all state transitions
8. ExecutionSession persisted in CHECKPOINT.md alongside checkpoint data
9. Coordinator handles crash recovery: no session exists but checkpoint does
10. Existing ExecuteSliceUseCase tests still pass (no regression)

## Edge Cases

- **Single-wave slice + SIGINT**: Wave completes before signal check (check is at next iteration start). Result is `completed`, not `paused`. Correct behavior — work is done.
- **Singleton coordinator across slices**: `startExecution` must validate/clear `activeSession` if it belongs to a different slice. Reject with error if a different slice is still running.
- **Crash between confirmPause and session save**: Session persisted as `running` on disk. The `/tff:pause` tool handles this — finds orphaned `running` session, transitions to `paused`.
- **Resume after failed session**: `/tff:resume` rejects with clear message: "Session is failed, use /tff:execute for fresh start."
- **Double SIGINT**: `AbortController.abort()` is idempotent. Safe, no special handling.
- **reconstituted session has fresh AbortController**: `isPauseRequested` returns `false` after reconstitution. Only checked in the in-memory coordinator flow, never after reconstitution. Invariant documented in code.

## Non-Goals

- Cross-process pause signaling (same-process only)
- Partial wave resume (always starts from next incomplete wave)
- Rollback command (RollbackSliceUseCase exists but not wired here)
- Execution dashboard / progress streaming
- Multi-slice concurrent execution
- Automatic retry on resume (continues, doesn't retry failed tasks from previous run)

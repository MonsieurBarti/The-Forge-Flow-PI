# M03-S03: Cross-Hexagon Event Wiring

## Problem

S01/S02 delivered `WorkflowSession` (state machine + transitions) and autonomy modes, but no orchestration exists to synchronize workflow phase changes with slice status transitions. The `InProcessEventBus` and `WorkflowPhaseChangedEvent` exist but no cross-hexagon coordination is wired. Without this, downstream commands (S05-S08) have no orchestration layer to plug into.

## Approach

**Cross-hexagon command port pattern** (architecture rule #2):
- Workflow hexagon defines `SliceTransitionPort` (what it needs)
- Slice hexagon provides `WorkflowSliceTransitionAdapter` (how it's done)
- `OrchestratePhaseTransitionUseCase` coordinates the full sequence: trigger session, transition slice, publish event

Domain events remain fire-and-forget notifications. The existing `InProcessEventBus` (sequential handler execution) is sufficient — no new event bus implementation needed.

## Design

### 1. Phase-to-Status Mapping

Pure function in workflow hexagon. Returns `SliceStatus | null` (null = no slice transition needed).

| Workflow Phase | Slice Status | Notes |
|---|---|---|
| idle | null | No active slice |
| discussing | discussing | 1:1 |
| researching | researching | 1:1 |
| planning | planning | 1:1 |
| executing | executing | 1:1 |
| verifying | verifying | 1:1 |
| reviewing | reviewing | 1:1 |
| shipping | completing | Rename |
| completing-milestone | null | All slices already closed |
| paused | null | Slice stays in last status |
| blocked | null | Slice stays in last status |

**Special case:** `shipping + next -> idle` triggers slice -> `closed` (handled in use case, not in mapping function).

### 2. SliceTransitionPort

Defined in workflow hexagon. Slice hexagon provides adapter.

```
// workflow/domain/ports/slice-transition.port.ts
abstract class SliceTransitionPort {
  abstract transition(
    sliceId: string,
    targetStatus: SliceStatus,
  ): Promise<Result<void, SliceTransitionError>>;
}
```

Error: `SliceTransitionError extends WorkflowBaseError` with code `WORKFLOW.SLICE_TRANSITION_FAILED`.

### 3. WorkflowSliceTransitionAdapter

Lives in slice hexagon infrastructure. Implements `SliceTransitionPort`.

```
// slice/infrastructure/workflow-slice-transition.adapter.ts
class WorkflowSliceTransitionAdapter extends SliceTransitionPort {
  constructor(
    sliceRepo: SliceRepositoryPort,
    dateProvider: DateProviderPort,
  ) {}

  async transition(sliceId, targetStatus):
    1. Load slice via repo (not found -> wrap as SliceTransitionError)
    2. If slice.status === targetStatus -> return ok (idempotent no-op)
    3. Call slice.transitionTo(targetStatus, dateProvider.now())
       On InvalidTransitionError -> wrap as SliceTransitionError with cause
    4. Save slice (on PersistenceError -> wrap as SliceTransitionError with cause)
    5. Return ok
}
```

**Error wrapping:** The adapter catches `InvalidTransitionError` and `PersistenceError` from the slice hexagon and wraps them into `SliceTransitionError`, preserving the original message in the `cause` field. This maintains the hexagonal boundary — workflow hexagon only sees its own error type.

**Idempotent transitions:** If the slice is already in the target status (e.g., slice created in `discussing` and workflow transitions to `discussing`), the adapter returns `ok` without calling `transitionTo()`. This avoids `SliceStatusVO` rejecting self-transitions.

In-memory adapter mirrors real adapter using `InMemorySliceRepository`.

### 4. OrchestratePhaseTransitionUseCase

Central coordination use case in workflow hexagon application layer.

**Input:**
```
{
  milestoneId: string
  trigger: WorkflowTrigger
  guardContext: GuardContext
}
```

**Output:** `Result<PhaseTransitionResult, WorkflowBaseError>`
```
{
  fromPhase: WorkflowPhase
  toPhase: WorkflowPhase
  sliceTransitioned: boolean
}
```

**Dependencies (injected):**
- `WorkflowSessionRepositoryPort`
- `SliceTransitionPort`
- `EventBusPort`
- `DateProviderPort`

**Flow:**
1. Load WorkflowSession by milestoneId
2. Capture `fromPhase = session.currentPhase` and `capturedSliceId = session.sliceId` (must capture before trigger — `clearSlice` effect wipes `sliceId` during trigger)
3. Call `session.trigger(trigger, guardContext, now)`
4. Detect if slice was cleared: `sliceCleared = capturedSliceId !== undefined && session.sliceId === undefined`
5. If `sliceCleared` AND `session.currentPhase === 'idle'` AND `fromPhase === 'shipping'`:
   - Transition slice to `closed` via `SliceTransitionPort.transition(capturedSliceId, 'closed')`
6. Else if `sliceCleared` (e.g., `blocked + abort -> idle`):
   - Do NOT transition slice — leave in current status (abort ≠ successful completion)
7. Else if `mapPhaseToSliceStatus(session.currentPhase)` returns a status AND `capturedSliceId` is defined:
   - Transition slice to that status via `SliceTransitionPort.transition(capturedSliceId, mappedStatus)`
8. Save session
9. Pull domain events from session, publish each via EventBus
10. Return `{ fromPhase, toPhase: session.currentPhase, sliceTransitioned }`

**Error handling:**
- Session not found -> `WorkflowSessionNotFoundError`
- Transition invalid -> `NoMatchingTransitionError` / `GuardRejectedError` (from S01)
- Slice transition failed -> `SliceTransitionError` (wraps adapter errors)
- On slice transition failure: session state is NOT rolled back (workflow is source of truth; slice error is surfaced to caller)

### 5. Barrel Export Updates

**Workflow hexagon (`index.ts`):**
- Add: `SliceTransitionPort`, `SliceTransitionError`, `mapPhaseToSliceStatus`, `OrchestratePhaseTransitionUseCase`, `PhaseTransitionResult`

**Slice hexagon (`index.ts`):**
- Add: `WorkflowSliceTransitionAdapter`, `InMemoryWorkflowSliceTransitionAdapter`

### 6. WorkflowExtensionDeps Update

Add `SliceTransitionPort` to `WorkflowExtensionDeps` interface so it can be injected at extension registration time.

## Files

| File | Action |
|---|---|
| `src/hexagons/workflow/domain/phase-status-mapping.ts` | Create |
| `src/hexagons/workflow/domain/phase-status-mapping.spec.ts` | Create |
| `src/hexagons/workflow/domain/ports/slice-transition.port.ts` | Create |
| `src/hexagons/workflow/domain/errors/slice-transition.error.ts` | Create |
| `src/hexagons/workflow/application/orchestrate-phase-transition.use-case.ts` | Create |
| `src/hexagons/workflow/application/orchestrate-phase-transition.use-case.spec.ts` | Create |
| `src/hexagons/slice/infrastructure/workflow-slice-transition.adapter.ts` | Create |
| `src/hexagons/slice/infrastructure/workflow-slice-transition.adapter.spec.ts` | Create |
| `src/hexagons/slice/infrastructure/in-memory-workflow-slice-transition.adapter.ts` | Create |
| `src/hexagons/workflow/index.ts` | Modify (barrel exports) |
| `src/hexagons/slice/index.ts` | Modify (barrel exports) |

## Acceptance Criteria

1. `SliceTransitionPort` abstract class in workflow hexagon with `transition(sliceId, targetStatus)` method
2. `WorkflowSliceTransitionAdapter` in slice hexagon drives `Slice.transitionTo()` internally
3. `mapPhaseToSliceStatus()` returns correct mapping for all 11 phases (7 mapped, 4 null)
4. `OrchestratePhaseTransitionUseCase` coordinates: trigger session -> transition slice -> publish event
5. Special case: `shipping + next -> idle` transitions slice to `closed` (clearSlice effect is applied automatically by the aggregate)
6. `blocked + abort -> idle` unlinks slice (leaves in current status, does NOT transition to closed)
7. `WorkflowPhaseChangedEvent` published on every successful transition
7. No race conditions: workflow is single source of truth for slice transitions
8. Adapter handles idempotent transitions (current == target returns ok without calling transitionTo)
9. All new code has colocated tests using builders + in-memory adapters
10. Barrel exports updated for both workflow and slice hexagons

## Non-Goals

- No new event types beyond what S01/S02 defined
- No notification handlers (deferred to S05-S08)
- No changes to InProcessEventBus implementation
- No context staging area (S04)
- No command handlers or PI extension registration (S05+)

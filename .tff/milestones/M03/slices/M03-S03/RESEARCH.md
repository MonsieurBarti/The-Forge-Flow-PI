# M03-S03 Research: Cross-Hexagon Event Wiring

## Key Findings

### 1. Slice Entity API

- `Slice.transitionTo(target: SliceStatus, now: Date): Result<void, InvalidTransitionError>` — requires `Date` param (spec already accounts for this)
- `SliceStatusVO.TRANSITIONS` map: 7 entries (discussing→researching, researching→planning, etc.), `closed` is terminal (no outgoing)
- Self-transitions not allowed in `SliceStatusVO` — adapter must handle idempotent no-op (spec already accounts for this)
- `Slice.status` getter returns raw `SliceStatus` string union

### 2. WorkflowSession.trigger() Behavior

- Signature: `trigger(trigger: WorkflowTrigger, ctx: GuardContext, now: Date): Result<void, WorkflowBaseError>`
- Effects are applied in-place (opaque to caller) — `clearSlice` sets `this.props.sliceId = undefined`
- Matched rule is NOT returned — caller must inspect resulting state to detect effects
- Detection strategy: compare `session.sliceId` before/after trigger to detect `clearSlice`
- Events buffered via `addEvent()`, pulled via `pullEvents()` after save

### 3. Error Conventions

- All errors extend `BaseDomainError` (kernel) with `readonly code: string` and optional `metadata`
- Workflow errors extend `WorkflowBaseError extends BaseDomainError`
- Error codes: `"WORKFLOW.GUARD_REJECTED"`, `"WORKFLOW.NO_MATCHING_TRANSITION"`, etc.
- New `SliceTransitionError` follows pattern: `code = "WORKFLOW.SLICE_TRANSITION_FAILED"`, metadata includes `{ sliceId, cause }`

### 4. Adapter Patterns

- Abstract port class → concrete adapter extends it
- In-memory adapters: `Map<string, Props>` store, `seed(entity)` and `reset()` for tests
- All methods return `Promise<Result<T, PersistenceError>>`
- `findById` returns `ok(null)` for not-found (not an error)
- Reconstitute entities from stored props via `Entity.reconstitute(props)`

### 5. Barrel Export Organization

Workflow barrel: grouped by Domain (Autonomy, Errors, Escalation, Events, Ports, Transition Table, Aggregate, Builder, Schemas) → Infrastructure → Extensions → Use Cases. Types via `export type {}`, implementations via `export {}`.

Slice barrel: compact (22 lines), exports errors, events, port, types, schemas.

### 6. WorkflowExtensionDeps

```typescript
interface WorkflowExtensionDeps {
  projectRepo: ProjectRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sliceRepo: SliceRepositoryPort;
  taskRepo: TaskRepositoryPort;
}
```

Need to add: `sliceTransitionPort: SliceTransitionPort`, `eventBus: EventBusPort`, `dateProvider: DateProviderPort`.

## Integration Notes

- `Slice.transitionTo` emits `SliceStatusChangedEvent` when status changes (not on idempotent no-op) — events from both session and slice should be published
- The adapter handles slice events internally; the use case only publishes workflow events from session
- `WorkflowPhaseChangedEvent` already captures `fromPhase`, `toPhase`, `trigger`, `retryCount`, `sliceId`, `milestoneId`

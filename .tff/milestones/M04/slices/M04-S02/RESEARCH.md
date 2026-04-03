# M04-S02 Research: Journal Entity + Replay

## Key Findings

### 1. Execution Hexagon Patterns (follow exactly)

- **Constructor**: Private + `static createNew()` + `static reconstitute()`
- **Business methods**: Return `Result<void, SpecificError>`, guard clauses first, `ok(undefined)` on success
- **Events**: `this.addEvent(new Event({...}))` inside business methods. Pulled via `pullEvents()` after save.
- **Builder**: Private faker defaults, `withX()` chaining, `build()` (aggregate) + `buildProps()` (raw data)
- **Repository port**: Abstract class, methods return `Promise<Result<T, PersistenceError>>`
- **In-memory adapter**: `Map<key, Props>`, `seed()` + `reset()` helpers, `toJSON()` for storage, `reconstitute()` for retrieval
- **Contract spec**: `runContractTests(name, () => repo)` shared function, adapter-specific tests in separate describe block
- **Barrel**: Export schemas + types + errors + events + ports + in-memory adapter. Never export aggregates or builders.
- **Imports**: `@kernel` alias, no `.js` extensions, `type` imports for type-only

### 2. Event System

- **InProcessEventBus**: Sequential handler execution, errors caught + logged (not rethrown)
- **No event subscriptions wired yet** — journal handler will be first. Must register in CLI bootstrap (`src/cli/extension.ts`)
- **Event payload**: Existing events are minimal (mostly just `aggregateId` + `occurredAt`). Extensions needed per spec.
- **EVENT_NAMES**: `as const` literals, format `<domain>.<action>` kebab-case. No journal names exist yet.
- **Publish pattern**: After repository save, `for...of` with `await` on `pullEvents()`

### 3. GitPort Extension Points

- **`runGit()` helper**: `execFile` with `["--no-pager", "-c", "color.ui=never", ...args]`, clean env
- **Error mapping**: `mapError()` checks stderr for known patterns → typed `GitError`
- **GitLogEntry schema**: Has `hash` + `message` fields — usable for commit filtering
- **Integration tests**: `mkdtempSync` temp repo, `beforeAll` init, `afterAll` cleanup, `beforeEach` reset
- **Implementation for new methods**:
  - `revert`: `runGit(["revert", "--no-edit", hash])`
  - `isAncestor`: `runGit(["merge-base", "--is-ancestor", ancestor, descendant])` — exit 0 = true, exit 1 = false

### 4. Slice Transition

- **WorkflowSliceTransitionAdapter**: Loads slice → calls `slice.transitionTo()` → saves
- **In-memory test adapter** exists: `InMemoryWorkflowSliceTransitionAdapter` with `seed()`/`reset()`
- **SliceTransitionPort** lives in workflow hexagon's ports

### 5. File I/O Patterns

- `node:fs/promises` for async I/O (`readFile`, `writeFile`, `appendFile`, `rename`)
- ENOENT check: `error instanceof Error && "code" in error && error.code === "ENOENT"` → `ok(null)`, not error
- Markdown adapter uses atomic write: write `.tmp` → `rename`
- Date deserialization: manual `new Date()` reconstruction before Zod parse

## Critical Issue: Slice State Machine Gap

**The `SliceStatusVO` transition map does NOT include `executing → planning`.**

Current transitions from `executing`: only `executing → verifying`.

The spec's `RollbackSliceUseCase` needs to transition from `executing` back to `planning`. This is a **back-edge** not yet in the state machine.

**Resolution**: Add `executing → planning` back-edge to `SliceStatusVO.TRANSITIONS`. This aligns with the conventions doc pattern (other back-edges: `verifying → executing`, `reviewing → executing`). Must be done as part of S02 or as a prerequisite task.

## Implementation Risks

| Risk | Mitigation |
|---|---|
| State machine back-edge missing | Add `executing → planning` to SliceStatusVO |
| Event bus swallows handler errors | Documented in spec as best-effort audit — acceptable |
| No bootstrap wiring for event subscriptions yet | Journal handler will be first; register in `extension.ts` |
| `isAncestor` exit code 1 is not a git error (means "not ancestor") | Map non-zero exit to `ok(false)`, not `err()` |
| Date serialization in JSONL | Use ISO 8601 strings, reconstruct with `new Date()` before Zod parse |

## File Structure (planned)

```
src/hexagons/execution/
  domain/
    journal-entry.schemas.ts              # Discriminated union + base schema
    journal-entry.schemas.spec.ts         # Parse valid/invalid, all 7 types
    journal-entry.builder.ts              # Faker-based builder per entry type
    errors/
      journal-write.error.ts
      journal-read.error.ts
      journal-replay.error.ts
      rollback.error.ts
    ports/
      journal-repository.port.ts          # append, readAll, readSince, count
  application/
    replay-journal.use-case.ts            # Read-only cross-validation
    replay-journal.use-case.spec.ts
    rollback-slice.use-case.ts            # Revert commits, transition state
    rollback-slice.use-case.spec.ts
    journal-event-handler.ts              # Subscribe to domain events
    journal-event-handler.spec.ts
  infrastructure/
    jsonl-journal.repository.ts           # JSONL file adapter
    jsonl-journal.repository.spec.ts      # Integration tests (temp dir)
    in-memory-journal.repository.ts       # Map-based test adapter
    in-memory-journal.repository.spec.ts
    journal-repository.contract.spec.ts   # Shared test suite

src/kernel/
  ports/git.port.ts                       # +revert, +isAncestor
  infrastructure/git-cli.adapter.ts       # +revert, +isAncestor impl
  event-names.ts                          # +JOURNAL_ENTRY_APPENDED (if needed)

src/hexagons/execution/domain/events/
  checkpoint-saved.event.ts               # +completedTaskCount field

src/hexagons/task/domain/events/
  task-completed.event.ts                 # +sliceId, +waveIndex, +durationMs, +commitHash
  task-blocked.event.ts                   # +sliceId, +waveIndex, +errorCode, +errorMessage

src/hexagons/slice/domain/events/
  slice-status-changed.event.ts           # +from, +to fields

src/hexagons/slice/domain/
  slice-status.vo.ts                      # +executing→planning back-edge
```

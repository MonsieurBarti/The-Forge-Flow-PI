# M04-S10 Research: Execute/Pause/Resume Commands

## 1. MarkdownCheckpointRepository — Collaborative Writer Fix

**File**: `execution/infrastructure/markdown-checkpoint.repository.ts`

**Finding**: `save()` is a **full render** pattern — `checkpoint.toJSON()` → `renderMarkdown()` → atomic write. It does NOT read-modify-write. The `renderMarkdown()` method generates the entire file content from `CheckpointProps`, ending with `<!-- CHECKPOINT_JSON\n{json}\n-->`.

**Impact**: A naive session adapter writing `<!-- session-data: {...} -->` to the same file will have its block **destroyed** on every checkpoint save.

**Fix**: Modify `save()` to extract and preserve any `<!-- session-data: ... -->` block before re-rendering:
```typescript
// Before writeFile:
let existingSessionBlock = "";
try {
  const current = await readFile(filePath, "utf-8");
  const sessionMatch = current.match(/<!-- session-data: ([\s\S]*?) -->/);
  if (sessionMatch) {
    existingSessionBlock = `<!-- session-data: ${sessionMatch[1]} -->`;
  }
} catch { /* file doesn't exist */ }

let content = this.renderMarkdown(props);
if (existingSessionBlock) {
  content += `\n${existingSessionBlock}\n`;
}
```

**Session adapter**: Uses same read-modify-write pattern. Reads file, replaces/appends `<!-- session-data -->` block, preserves `<!-- CHECKPOINT_JSON -->` block.

**Integration test required**: checkpoint save → session save → checkpoint save → verify both blocks survive.

## 2. ExecuteSliceUseCase Signal Insertion Point

**File**: `execution/application/execute-slice.use-case.ts`

**Method signature** (line 178): Add `signal?: AbortSignal` as second parameter. Schema unchanged.

**Signal check location**: After line 483 (advanceWave checkpoint save + event publish), before `wavesCompleted++`:
```typescript
// After checkpoint events published
if (signal?.aborted) {
  return ok({ sliceId, completedTasks, failedTasks, skippedTasks, wavesCompleted, totalWaves: waves.length, aborted: true });
}
wavesCompleted++;
```

**Edge case**: Single-wave slice — signal check never fires (loop exits naturally after only wave). Result is `completed`, not `paused`. This is correct behavior — work is done.

## 3. Event System Patterns

**EVENT_NAMES** (`kernel/event-names.ts`): Naming convention is `domain.kebab-action`. New entries:
```typescript
EXECUTION_STARTED: "execution.started"
EXECUTION_PAUSED: "execution.paused"
EXECUTION_RESUMED: "execution.resumed"
EXECUTION_COMPLETED: "execution.completed"
EXECUTION_FAILED: "execution.failed"
```

**DomainEvent base** (`kernel/domain-event.base.ts`): Requires `eventName`, `id`, `aggregateId`, `occurredAt`. Constructor validates via `DomainEventPropsSchema.parse()`.

**Event class template** (from `CheckpointSavedEvent`):
1. Extend `DomainEventPropsSchema` with event-specific fields
2. Class extends `DomainEvent`, stores parsed fields as readonly
3. `eventName` assigned from `EVENT_NAMES` constant

**JournalEventHandler** (`execution/application/journal-event-handler.ts`): Subscribes via `eventBus.subscribe(EVENT_NAMES.X, handler)`. Each handler casts event, constructs journal entry, calls `journalRepo.append()`. Currently has 4 subscriptions — will gain 5 more for execution lifecycle.

## 4. AggregateRoot Pattern

**Base** (`kernel/aggregate-root.base.ts`): Extends `Entity<TProps>`. Provides `addEvent()` (protected) and `pullEvents()` (public). Events stored in private array, cleared on pull.

**Checkpoint exemplar**:
- Private constructor, public `createNew()` + `reconstitute()` factories
- State machine methods: validate preconditions → update `this.props` → `this.addEvent()` → return `Result`
- Queries via getters on `this.props`
- `toJSON()` returns serializable props

**For ExecutionSession**: Same pattern. AbortController is a **private transient field** (not in props, not serialized). Created in `start()` and `resume()`, re-created in `reconstitute()`.

## 5. InMemory Adapter Pattern

**Template** (from `InMemoryCheckpointRepository`):
- `Map<sliceId, Props>` storage
- `save()`: stores `entity.toJSON()`
- `findBySliceId()`: returns `Entity.reconstitute(props)` or null
- `delete()`: removes from map
- `seed(entity)`: pre-populate for tests
- `reset()`: clear store

All methods return `Promise<Result<T, Error>>`.

## 6. PI Extension Tool Registration

**Pattern** (from `workflow.extension.ts`):
1. Define `ExtensionDeps` interface with all required ports
2. Export `registerXExtension(api, deps)` function
3. Instantiate use cases from deps inside the function
4. Register tools via `api.registerTool(createZodTool({...}))` or commands via `api.registerCommand()`

**Tool pattern** (from `write-spec.tool.ts`):
- Zod schema with `.describe()` on each field
- `execute` callback: call use case, return `textResult(JSON.stringify(result))`
- Factory function: `createXTool(useCase)` → returns `createZodTool({...})`

**For ExecutionExtension**: Coordinator instantiated once, shared across 3 tools. Tools are thin wrappers calling coordinator methods.

## 7. SIGINT Behavior in Node.js

**Key findings**:
- `process.on('SIGINT')` fires synchronously, async cleanup requires flag guarding
- AbortController.abort() is idempotent (safe for double SIGINT)
- SIGINT propagation inside PI SDK tool handlers is **unverified**
- `Promise.allSettled` does not auto-reject on signal — manual check required between waves

**PauseSignalPort resolution**: Abstracts signal source behind a port. `ProcessSignalPauseAdapter` wraps `process.on('SIGINT')`. `InMemoryPauseSignalAdapter` exposes `triggerPause()` for deterministic tests. Port pattern allows swapping to file-sentinel adapter if SIGINT doesn't propagate in PI context.

**ProcessSignalPauseAdapter implementation**:
```typescript
class ProcessSignalPauseAdapter extends PauseSignalPort {
  private handler: (() => void) | null = null;
  register(callback: () => void): void {
    this.handler = callback;
    process.on('SIGINT', this.handler);
  }
  dispose(): void {
    if (this.handler) {
      process.removeListener('SIGINT', this.handler);
      this.handler = null;
    }
  }
}
```

## Summary: Key Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Checkpoint render destroys session block | High | Read-extract-preserve pattern in checkpoint adapter `save()` |
| SIGINT propagation unverified in PI SDK | Medium | PauseSignalPort abstraction, swappable adapters |
| Signal check only between waves | Low | Documented behavior, acceptable for between-wave pause model |
| Two adapters writing same file | Medium | Sequential writes guaranteed, integration test covers coordination |
| AbortController not serializable | Low | Transient field, re-created on reconstitute |

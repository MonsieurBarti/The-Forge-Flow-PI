# M04-S07 Research: Wave-Based Execution Engine

## 1. Port Signatures (exact contracts)

### TaskRepositoryPort (task hex)
```typescript
findBySliceId(sliceId: Id): Promise<Result<Task[], PersistenceError>>
```
Returns Task aggregates (not DTOs). Task exposes: `id`, `sliceId`, `label`, `title`, `description`, `acceptanceCriteria` (string), `filePaths` (string[]), `status` (TaskStatus), `blockedBy` (Id[]), `waveIndex` (number|null), `updatedAt`.

### WaveDetectionPort (task hex)
```typescript
detectWaves(tasks: readonly TaskDependencyInput[]): Result<Wave[], CyclicDependencyError>
```
**Synchronous** (¬Promise). Requires mapping `Task[]` → `TaskDependencyInput[]` (`{ id, blockedBy }`).
`Wave = { index: number (≥0), taskIds: Id[] (≥1) }`.

### CheckpointRepositoryPort (execution hex)
```typescript
save(checkpoint: Checkpoint): Promise<Result<void, PersistenceError>>
findBySliceId(sliceId: string): Promise<Result<Checkpoint | null, PersistenceError>>
delete(sliceId: string): Promise<Result<void, PersistenceError>>
```

### AgentDispatchPort (execution hex)
```typescript
dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>>
abort(taskId: string): Promise<void>
isRunning(taskId: string): boolean
```

### WorktreePort (execution hex)
```typescript
exists(sliceId: string): Promise<boolean>  // ¬Result wrapper, plain boolean
```

### EventBusPort (kernel)
```typescript
publish(event: DomainEvent): Promise<void>
subscribe(eventType: EventName, handler: (event: DomainEvent) => Promise<void>): void
```
Sequential handler execution. Swallows handler errors w/ logging.

### DateProviderPort (kernel)
```typescript
now(): Date
```

## 2. Checkpoint Aggregate API

```
Checkpoint.createNew({ id, sliceId, baseCommit, now }) → Checkpoint
  initializes: version=1, currentWaveIndex=0, completedWaves=[], completedTasks=[], executorLog=[]

recordTaskStart(taskId, agentIdentity, now) → Result<void, InvalidCheckpointStateError>
recordTaskComplete(taskId, now) → Result<void, InvalidCheckpointStateError>
  adds taskId → completedTasks, emits CheckpointSavedEvent via addEvent()

advanceWave(now) → Result<void, InvalidCheckpointStateError>
  adds currentWaveIndex → completedWaves, increments currentWaveIndex, emits CheckpointSavedEvent

isTaskCompleted(taskId) → boolean
isWaveCompleted(waveIndex) → boolean
isTaskStarted(taskId) → boolean
pullEvents() → DomainEvent[]  // inherited from AggregateRoot
```

## 3. Event Contracts

### Events to emit

| Event | Source hex | Props (beyond base) |
|---|---|---|
| `TaskCompletedEvent` | task | sliceId, taskId, waveIndex, durationMs, commitHash? |
| `TaskBlockedEvent` | task | sliceId, taskId, waveIndex, errorCode, errorMessage |
| `TaskExecutionCompletedEvent` | execution | taskId, sliceId, milestoneId, waveIndex, modelProfile, agentResult |
| `CheckpointSavedEvent` | execution | sliceId, waveIndex, completedTaskCount (emitted by Checkpoint aggregate) |
| `AllTasksCompletedEvent` | execution | sliceId, milestoneId, completedTaskCount, totalWaveCount (**NEW — S07**) |

Base props: `{ id: UUID, aggregateId: UUID, occurredAt: Date, correlationId?, causationId? }`

### Event handler registration pattern

```typescript
// Both handlers expose register(eventBus): void
journalHandler.register(eventBus);   // subscribes: TASK_COMPLETED, TASK_BLOCKED, CHECKPOINT_SAVED, SLICE_STATUS_CHANGED
metricsUseCase.register(eventBus);   // subscribes: TASK_EXECUTION_COMPLETED
```

Pattern: `register(eventBus: EventBusPort): void` → internal `eventBus.subscribe(EVENT_NAME, handler)`.
Handler: `private async onEventType(event: DomainEvent): Promise<void>` w/ `instanceof` check.

## 4. AgentDispatchConfig Schema

```typescript
AgentDispatchConfigSchema = z.object({
  taskId: IdSchema,
  sliceId: IdSchema,
  agentType: AgentTypeSchema,           // "executor" after S07 extension
  workingDirectory: z.string().min(1),
  systemPrompt: z.string(),             // can be empty string
  taskPrompt: z.string().min(1),
  model: ResolvedModelSchema,           // { provider, modelId }
  tools: z.array(z.string()).min(1),
  filePaths: z.array(z.string()).default([]),
});
```

## 5. AgentResult Schema (post-S06)

```typescript
AgentResultSchema = z.object({
  taskId: IdSchema,
  agentType: AgentTypeSchema,
  status: AgentStatusSchema,            // DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
  output: z.string(),
  filesChanged: z.array(z.string()).default([]),
  concerns: z.array(AgentConcernSchema).default([]),
  selfReview: SelfReviewChecklistSchema, // mandatory, 4 dimensions
  cost: AgentCostSchema,                // { provider, modelId, inputTokens, outputTokens, costUsd }
  durationMs: z.number().int().nonnegative(),
  error: z.string().optional(),
});
```

`isSuccessfulStatus(status)` → true for DONE ∨ DONE_WITH_CONCERNS.

## 6. PI Adapter Prompt Assembly

```
fullSystemPrompt = config.systemPrompt + "\n\n" + AGENT_STATUS_PROMPT
prompt = fullSystemPrompt + "\n\n---\n\n" + config.taskPrompt
```

∴ PromptBuilder.systemPrompt should contain skill XML ¬AGENT_STATUS_PROMPT (adapter appends it).

## 7. In-Memory Adapter Test API

```typescript
InMemoryAgentDispatchAdapter:
  givenResult(taskId, Result<AgentResult, AgentDispatchError>)
  givenDelayedResult(taskId, result, delayMs)
  dispatchedConfigs: readonly AgentDispatchConfig[]
  wasDispatched(taskId): boolean
  reset(): void
```

## 8. Worktree Path Resolution

```
GitWorktreeAdapter.pathFor(sliceId) = join(projectRoot, ".tff", "worktrees", sliceId)
```

## 9. Test Patterns

```typescript
// Setup
let repo: InMemoryMetricsRepository;
let bus: InProcessEventBus;
let useCase: RecordTaskMetricsUseCase;

beforeEach(() => {
  repo = new InMemoryMetricsRepository();
  bus = new InProcessEventBus(new SilentLoggerAdapter());
  useCase = new RecordTaskMetricsUseCase(repo);
  useCase.register(bus);
});

// Verify events via repo state after publish
await bus.publish(event);
const result = await repo.readAll();
expect(isOk(result)).toBe(true);
```

Builders: faker-based, fluent `.withX()`, terminal `.build()`.
In-memory repos: `Map<string, Props>`, `.seed()`, `.reset()`, `.toJSON()`/`.reconstitute()`.

## 10. Key Implementation Notes

1. **Wave detection is sync** — ¬await, direct `Result<Wave[], CyclicDependencyError>`
2. **Task → TaskDependencyInput mapping** required before calling `detectWaves()`
3. **Checkpoint.pullEvents()** after `recordTaskComplete()`/`advanceWave()` — must publish via eventBus
4. **systemPrompt should ¬include AGENT_STATUS_PROMPT** — PI adapter appends it automatically
5. **WorktreePort.exists() returns boolean** — ¬Result, can check directly
6. **acceptanceCriteria is string** (¬string[]) on Task — split if needed for template interpolation
7. **AgentTypeSchema needs "executor"** — must extend before PromptBuilder can set it
8. **Event handlers must register before dispatch** — subscribe order matters for journal/metrics capture

# Research — M03-S07: Plan Command

## Questions Investigated

1. What patterns do existing commands (discuss, research) follow for command handlers, protocols, and tools?
2. How does the task hexagon expose Task creation, wave detection, and wave assignment?
3. What's missing from the slice aggregate for plan support?
4. How does the workflow extension wire deps, tools, and commands?
5. How are protocol templates structured and rendered?

## Codebase Findings

### Existing Patterns

**Command handler pattern** (`discuss.command.ts`, `research.command.ts`):
- `registerXxxCommand(api, deps)` function with typed `XxxCommandDeps` interface
- Dual slice resolution: `findByLabel()` → fallback `findById()`
- Validate preconditions (phase, artifacts), send protocol via `ctx.sendUserMessage()`
- All failures return early with user-friendly messages, no exceptions

**Use case pattern** (`write-spec.use-case.ts`, `write-research.use-case.ts`):
- Constructor DI: `artifactFilePort`, `sliceRepo`, `dateProvider`
- Execute: write artifact → load slice → set path → save slice
- Returns `Result<{path}, FileIOError | SliceNotFoundError | PersistenceError>`

**Tool pattern** (`write-spec.tool.ts`, `write-research.tool.ts`):
- `createWriteXxxTool(useCase)` factory → `createZodTool({...})`
- Schema uses `MilestoneLabelSchema`, `SliceLabelSchema`, `IdSchema`
- Execute: call use case, `isErr()` check → text result

**Protocol template pattern** (`discuss-protocol.ts`, `research-protocol.ts`):
- `.md` template in `templates/protocols/` loaded via `readFileSync(new URL(...))`
- `{{variable}}` replacement via regex
- Conditional autonomy instructions built before rendering
- `buildXxxProtocolMessage(params)` function

### Relevant Files

| File | Key Details |
|---|---|
| `task.aggregate.ts` | `createNew({id, sliceId, label, title, description?, acceptanceCriteria?, filePaths?, now})` |
| `task.schemas.ts` | `acceptanceCriteria: z.string().default("")`, `blockedBy: z.array(IdSchema).default([])` |
| `wave-detection.port.ts` | `detectWaves(tasks: readonly TaskDependencyInput[]): Result<Wave[], CyclicDependencyError>` |
| `wave.schemas.ts` | `TaskDependencyInput = {id: UUID, blockedBy: UUID[]}`, `Wave = {index: number, taskIds: UUID[]}` |
| `detect-waves.use-case.ts` | Kahn's algorithm, returns waves in execution order, CyclicDependencyError with path |
| `task.aggregate.ts:143-146` | `assignToWave(waveIndex: number, now: Date): void` — takes 2 params |
| `task-repository.port.ts` | `save()`, `findById()`, `findByLabel()`, `findBySliceId()` |
| `slice.aggregate.ts` | Has `setSpecPath()`, `setResearchPath()`, `planPath` getter — **missing `setPlanPath()`** |
| `workflow.extension.ts:27-40` | `WorkflowExtensionDeps` — **already has `taskRepo: TaskRepositoryPort`** |
| `artifact-file.port.ts:5` | `ArtifactType` already includes `'plan'` |
| `task/index.ts` | Exports: errors, events, ports, schemas — NOT Task entity or builder |

### Dependencies

- `TaskRepositoryPort` — already in `WorkflowExtensionDeps`
- `WaveDetectionPort` — **must add** to `WorkflowExtensionDeps`
- `DetectWavesUseCase` — implements `WaveDetectionPort`, exported from task barrel
- `ArtifactFilePort` — already supports 'plan' type
- `SliceRepositoryPort` — already wired

### Transition Table

- `planning + approve → executing` (effect: resetRetryCount) — human gate
- `planning + reject → planning` (effect: incrementRetry)
- Entry: `researching + next → planning`

## Technical Risks

1. **Two-pass task creation ordering**: Label→ID resolution requires all tasks created before blockedBy resolution. Spec already addresses this with explicit two-pass strategy.
2. **Task barrel exports**: Task entity and builder are NOT exported from `task/index.ts`. WritePlanUseCase lives in workflow hexagon — it needs to create Task entities. **Must either export Task from barrel or use TaskRepositoryPort differently.** This is the primary integration risk.

## Recommendations for Planning

1. **Spec correction**: `WorkflowExtensionDeps` already has `taskRepo` — only add `waveDetection: WaveDetectionPort`
2. **Spec correction**: `assignToWave(waveIndex, now)` takes 2 params — update spec step 6
3. **Critical**: Investigate how WritePlanUseCase creates Task entities when Task is not exported from task barrel. Options:
   - (a) Export `Task` and `TaskBuilder` from task barrel (simplest)
   - (b) Add a `CreateTaskPort` that wraps Task.createNew() (hexagonal-pure but more code)
   - (c) Add a `CreateTasksUseCase` in the task hexagon that WritePlanUseCase calls via port
4. **Template file**: Create `templates/protocols/plan.md` following existing `.md` template pattern
5. **Test pattern**: Follow write-research.spec.ts (has all 3 error cases covered)

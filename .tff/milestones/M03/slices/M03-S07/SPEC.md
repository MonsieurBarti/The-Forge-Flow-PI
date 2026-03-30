# M03-S07: Plan Command

## Problem

The workflow engine needs a plan command (`/tff:plan`) that breaks a spec into bite-sized tasks (2-5 min each), detects waves on the dependency graph, persists Task entities, writes PLAN.md, and presents the plan for human approval before execution begins.

The discuss command (S05) produces SPEC.md, the research command (S06) produces RESEARCH.md. The plan phase reads both, generates a structured plan with task decomposition, and gates on human approval before transitioning to executing.

## Approach

Single `WritePlanUseCase` following the established tool+protocol pattern from S05/S06. One use case handles PLAN.md writing, Task entity creation, and wave detection in one operation. Protocol-driven human gate (LLM asks user to approve/reject via protocol message). Compressed notation (Improvement I) applied to protocol and PLAN.md output.

New: plan.command.ts, plan-protocol.ts, WritePlanUseCase, tff_write_plan tool, Slice.setPlanPath(), CreateTasksPort (task hexagon port -- consumed by workflow hexagon via barrel import), CreateTasksUseCase (task hexagon use case implementing the port). Reuses: tff_workflow_transition, ArtifactFilePort (already supports 'plan' type), TaskRepositoryPort (already in WorkflowExtensionDeps), WaveDetectionPort.

## Design

### Use Cases

**WritePlanUseCase:**

```typescript
// hexagons/workflow/use-cases/write-plan.use-case.ts

Dependencies:
  - artifactFilePort: ArtifactFilePort
  - sliceRepo: SliceRepositoryPort
  - createTasksPort: CreateTasksPort    // cross-hexagon port (workflow -> task)
  - dateProvider: DateProviderPort

Input: {
  milestoneLabel: string,
  sliceLabel: string,
  sliceId: string,
  content: string,           // PLAN.md markdown (compressed notation)
  tasks: Array<{
    label: string,           // T01, T02...
    title: string,
    description: string,
    acceptanceCriteria: string,  // joined AC refs, e.g. "AC1, AC3" (matches TaskPropsSchema)
    filePaths: string[],
    blockedBy: string[],     // labels of blocking tasks (e.g. ["T01", "T02"])
  }>
}

Steps:
  1. artifactFilePort.write(milestoneLabel, sliceLabel, 'plan', content) -> path
  2. Load slice from sliceRepo by sliceId
  3. createTasksPort.createTasks({ sliceId, tasks }) -> { taskCount, waveCount }
     Delegates to task hexagon: two-pass creation, blockedBy resolution,
     wave detection, wave assignment. Returns CyclicDependencyError on cycles.
  4. slice.setPlanPath(path, dateProvider.now())
  5. sliceRepo.save(slice)

Output: Result<{
  path: string,
  taskCount: number,
  waveCount: number,
}, FileIOError | SliceNotFoundError | PersistenceError | CyclicDependencyError>

Error cases:
  - Slice not found -> SliceNotFoundError
  - File write fails -> FileIOError
  - Repo save fails -> PersistenceError
  - Cyclic dependencies -> CyclicDependencyError (from CreateTasksPort)
```

**CreateTasksPort (task hexagon -- consumed by workflow hexagon via barrel import):**

```typescript
// hexagons/task/domain/ports/create-tasks.port.ts

export interface TaskInput {
  label: string;             // T01, T02...
  title: string;
  description: string;
  acceptanceCriteria: string;
  filePaths: string[];
  blockedBy: string[];       // labels of blocking tasks
}

export interface CreateTasksResult {
  taskCount: number;
  waveCount: number;
}

export abstract class CreateTasksPort {
  abstract createTasks(params: {
    sliceId: string;
    tasks: TaskInput[];
  }): Promise<Result<CreateTasksResult, PersistenceError | CyclicDependencyError>>;
}
```

**CreateTasksUseCase (task hexagon):**

```typescript
// hexagons/task/application/create-tasks.use-case.ts

Dependencies:
  - taskRepo: TaskRepositoryPort
  - waveDetection: WaveDetectionPort
  - dateProvider: DateProviderPort

Implements CreateTasksPort. Steps (single-pass with pre-generated UUIDs):
  Pre-pass -- generate UUIDs, build label->ID map:
    For each task in input.tasks:
      a. Generate UUID
      b. Store in label->ID map
  Creation pass -- create all tasks with resolved blockedBy:
    For each task in input.tasks:
      a. Resolve blockedBy labels -> UUIDs via map
      b. Task.createNew({id, sliceId, label, title, description, acceptanceCriteria,
         filePaths, blockedBy: resolvedIds, now})
      c. taskRepo.save(task)
  Wave detection:
    Build TaskDependencyInput[] from created tasks
    waveDetection.detectWaves(inputs) -> waves
    CyclicDependencyError -> return error
  Wave assignment:
    For each wave: for each taskId: task.assignToWave(wave.index, now)
    taskRepo.save(task)

Output: Result<CreateTasksResult, PersistenceError | CyclicDependencyError>
```

### Tools

**`tff_write_plan`:**

```typescript
// infrastructure/pi/write-plan.tool.ts

const WritePlanSchema = z.object({
  milestoneLabel: MilestoneLabelSchema.describe("Milestone label, e.g. M03"),
  sliceLabel: SliceLabelSchema.describe("Slice label, e.g. M03-S07"),
  sliceId: IdSchema.describe("Slice UUID"),
  content: z.string().describe("Markdown plan content (compressed notation)"),
  tasks: z.array(z.object({
    label: z.string().describe("Task label, e.g. T01"),
    title: z.string().describe("Task title"),
    description: z.string().describe("Task description with TDD steps"),
    acceptanceCriteria: z.string().describe("Joined AC refs, e.g. 'AC1, AC3'"),
    filePaths: z.array(z.string()).describe("Exact file paths to create/modify/test"),
    blockedBy: z.array(z.string()).default([]).describe("Labels of blocking tasks"),
  })).describe("Task definitions"),
});
```

Uses `IdSchema` for sliceId (consistent with `tff_write_research`). Wraps WritePlanUseCase. Returns `{ ok: true, path, taskCount, waveCount }` or error text.

Reused as-is: `tff_workflow_transition` handles `planning + approve -> executing`.

### Command Handler

**`plan.command.ts`** -- registers `/tff:plan <slice-label-or-id>`:

```typescript
// infrastructure/pi/plan.command.ts

interface PlanCommandDeps {
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sessionRepo: WorkflowSessionRepositoryPort;
  artifactFile: ArtifactFilePort;
}

Handler flow:
  1. Resolve slice by label or UUID (same dual-resolution pattern as discuss/research)
  2. Load milestone from MilestoneRepositoryPort
  3. Load workflow session via sessionRepo.findByMilestoneId()
     - If null: error "No workflow session found. Run /tff:discuss first."
  4. Validate session.currentPhase === 'planning'
     - If not: error "Slice {label} is in {phase}, not planning."
  5. Read SPEC.md via artifactFile.read(milestoneLabel, sliceLabel, 'spec')
     - If null/error: error "No SPEC.md found. Run /tff:discuss first."
  6. Read RESEARCH.md via artifactFile.read(milestoneLabel, sliceLabel, 'research')
     - If null: proceed without research (optional for F-lite, skipped for S-tier)
  7. Send protocol message via ctx.sendUserMessage(
       buildPlanProtocolMessage({
         sliceId, sliceLabel, milestoneLabel, milestoneId,
         sliceTitle, sliceDescription, specContent, researchContent, autonomyMode
       })
     )
```

Registration via `registerPlanCommand(api, deps)` function called from `workflow.extension.ts`.

### Protocol Message

**`plan-protocol.ts`** -- `buildPlanProtocolMessage(params)`:

Template variables: `{sliceId}`, `{sliceLabel}`, `{milestoneLabel}`, `{milestoneId}`, `{sliceTitle}`, `{sliceDescription}`, `{specContent}`, `{researchContent}`, `{autonomyMode}`.

Written in compressed notation per Improvement I. Protocol instructs the LLM:

**Phase 1 -- Decompose:**
1. Read embedded SPEC.md + RESEARCH.md (if present)
2. Break spec into bite-sized tasks (2-5 min each)
3. Per task: exact file paths (create/modify/test), AC refs from spec, TDD steps, dependencies on other tasks
4. No "add to the service" -- concrete paths only

**Phase 2 -- Structure:**
5. Arrange tasks into dependency graph
6. Validate no cycles (blockedBy refs must be acyclic)
7. Format PLAN.md in compressed notation with:
   - Summary section (slice context, approach)
   - Task table (label, title, files, deps, wave)
   - Per task: detailed section with TDD steps + AC refs

**Phase 3 -- Write:**
8. Call `tff_write_plan` with tasks array + PLAN.md content
9. Report: wave count, task count, dependency summary

**Phase 4 -- Human Gate:**
10. Present plan summary: waves, tasks, estimated scope
11. Ask user: "Plan written to PLAN.md. Approve to proceed to execution, or reject to revise?"
12. If reject: revise based on feedback, rewrite (max 2 iterations), ask again
13. On approve: call `tff_workflow_transition` with trigger `approve`

**Auto-Transition:**
14. planning + approve is a human gate -- always pause for approval even in plan-to-pr
15. After approval, if plan-to-pr: invoke `/tff:execute {sliceLabel}`
16. If guided: suggest "Next: `/tff:execute {sliceLabel}`"

### Slice Aggregate Addition

```typescript
// In slice.aggregate.ts
setPlanPath(path: string, now: Date): void {
  this.props.planPath = path;
  this.props.updatedAt = now;
}
```

Consistent with existing `setSpecPath(path, now)` and `setResearchPath(path, now)` patterns. No domain event emitted.

### PLAN.md Format (Compressed Notation)

PLAN.md uses compressed notation per Improvement I. Tables/schemas stay verbose (already dense). Prose compressed with formal logic symbols.

```markdown
# Plan -- {sliceLabel}: {title}

## Summary
{compressed context -- 2-3 lines max}

## Tasks
| # | Title | Files | Deps | Wave |
|---|---|---|---|---|
| T01 | ... | `path/a.ts`, `path/a.spec.ts` | -- | 0 |
| T02 | ... | `path/b.ts` | T01 | 1 |

## T01: {title}
AC: AC1, AC3
Files: create `path/a.ts`, test `path/a.spec.ts`
Deps: --

### TDD
1. RED: test `describe(...)` expects X
2. GREEN: implement X
3. REFACTOR: extract if needed
```

### Workflow Extension Wiring

`WorkflowExtensionDeps`: adds `createTasksPort: CreateTasksPort` (new cross-hexagon port). Note: `taskRepo` already exists in deps.

New instantiations:
- `WritePlanUseCase(artifactFile, sliceRepo, createTasksPort, dateProvider)`

New registrations:
- `tff_write_plan` tool (via `createWritePlanTool`)
- `tff:plan` command (via `registerPlanCommand`)

`registerPlanCommand` receives: `{ sliceRepo, milestoneRepo, sessionRepo, artifactFile }` (same pattern as research).

**Task hexagon additions:**
- `CreateTasksUseCase` in `hexagons/task/application/` (implements `CreateTasksPort`)
- Export `CreateTasksUseCase` from `task/index.ts`
- `CreateTasksPort` is defined in task hexagon (alongside `TaskRepositoryPort`, `WaveDetectionPort`); `CreateTasksUseCase` implements it in task hexagon; workflow hexagon consumes it via `@hexagons/task` barrel import

### Barrel Exports

Additions to workflow `index.ts`:
- `WritePlanUseCase` from use-cases
- `createWritePlanTool` from infrastructure/pi
- `registerPlanCommand` from infrastructure/pi

Additions to task `index.ts`:
- `CreateTasksPort`, `TaskInput`, `CreateTasksResult` from domain/ports
- `CreateTasksUseCase` from application

## Acceptance Criteria

1. `tff:plan` command registers via `api.registerCommand`, resolves slice by label or UUID (same dual-resolution pattern as discuss/research), validates the workflow session is in `planning` phase, reads SPEC.md (required) and RESEARCH.md (optional), and sends PLAN_PROTOCOL_MESSAGE via `ctx.sendUserMessage`
2. Command handler returns error if session phase is not `planning` ("not planning")
3. Command handler returns error if no workflow session exists for the milestone ("No workflow session found, run /tff:discuss first")
4. Command handler returns error if SPEC.md does not exist ("No SPEC.md found, run /tff:discuss first") or if ArtifactFilePort.read returns FileIOError
5. WritePlanUseCase writes PLAN.md via ArtifactFilePort, delegates task creation to `CreateTasksPort.createTasks()`, and calls `slice.setPlanPath(path)` to update the Slice aggregate
6. `CreateTasksUseCase` (task hexagon) implements `CreateTasksPort`: single-pass creation with pre-generated UUIDs (pre-pass: generate UUIDs + build label→ID map; creation pass: resolve blockedBy labels to UUIDs via map, create tasks with resolved blockedBy via `Task.createNew({..., blockedBy: resolvedIds})`), runs wave detection via `WaveDetectionPort`, assigns waves via `task.assignToWave(waveIndex, now)`
7. WritePlanUseCase returns CyclicDependencyError (from CreateTasksPort) when dependency graph has cycles, FileIOError when ArtifactFilePort.write fails, SliceNotFoundError when slice doesn't exist, PersistenceError when repo save fails
8. `tff_write_plan` tool schema uses `IdSchema` for sliceId (UUID validation), `MilestoneLabelSchema` for milestoneLabel, `SliceLabelSchema` for sliceLabel
9. `CreateTasksUseCase` creates Task entities via single-pass strategy (pre-pass: generate UUIDs + build label→ID map; creation pass: resolve blockedBy labels to UUIDs, create with resolved blockedBy via `Task.createNew({..., blockedBy})`). `acceptanceCriteria` is a joined string (matches `TaskPropsSchema`). Wave detection runs on `TaskDependencyInput[]` built from created tasks. `assignToWave(waveIndex, now)` takes 2 params
10. Protocol message uses compressed notation (Improvement I) and contains: Phase 1 (decompose spec into tasks), Phase 2 (structure dependency graph), Phase 3 (write via tool), Phase 4 (human gate -- approve/reject, max 2 revision rounds)
11. PLAN.md uses compressed notation: tables for overview, formal logic symbols for prose, schemas/code uncompressed
12. After `tff_workflow_transition(approve)`, protocol checks autonomy mode: plan-to-pr invokes `/tff:execute`; guided suggests next step
13. `Slice.setPlanPath(path, now)` business method updates `planPath` and `updatedAt`, with corresponding tests
14. `registerWorkflowExtension` registers `tff_write_plan` tool and `tff:plan` command
15. All use cases return `Result<T, E>` -- no thrown exceptions in use case code

## Non-Goals

- Plannotator/ReviewUIPort integration (deferred -- uses protocol-driven human gate)
- Compressing existing discuss/research protocols (separate slice)
- Agent dispatch for plan generation (LLM generates directly via protocol)
- Execute command (later slice)
- Beads/Dolt integration (TFF-PI uses hexagonal ports)

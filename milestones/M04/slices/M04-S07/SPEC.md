# M04-S07: Wave-Based Execution Engine

## Problem

Slices contain tasks organized into dependency waves. No orchestrator exists to dispatch agents per-task in parallel within waves, checkpoint progress, handle failures, or resume from interruptions. R02 requires `ExecuteSliceUseCase` with wave detection, parallel dispatch, domain routing, stale claim detection, ∧ `AllTasksCompletedEvent`.

## Requirement Coverage

- **R02**: Wave-Based Parallel Dispatch — full coverage

## Dependencies (all closed)

- S01: Checkpoint entity + repository
- S02: Journal entity + replay
- S03: Agent dispatch port + PI adapter
- S04: Worktree management
- S05: Cost tracking (TaskExecutionCompletedEvent, RecordTaskMetricsUseCase)
- S06: Agent status protocol (structured AgentResult w/ status, concerns, selfReview)

## Approach

**Orchestrator + collaborators** — `ExecuteSliceUseCase` is a thin orchestrator owning the wave loop + checkpoint logic. Delegates to:
- `DomainRouter` — file paths → skills (hardcoded const mapping)
- `PromptBuilder` — task + skills → `AgentDispatchConfig` (loads compressed `.md` template from `src/resources/`)

### Why this approach

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Orchestrator + collaborators | Each concern testable in isolation, SRP, mockable | More files | **Selected** |
| Monolithic use case | Fewer files, simpler dep graph | 300+ line class, violates SRP | Rejected |
| Event-driven pipeline | Max decoupling | Hard to guarantee sequential waves, over-engineered | Rejected |

### Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Model config | Pre-resolved in input, ¬cross-hexagon dep | Caller (workflow/command) resolves model; execution hexagon stays independent |
| Failure mode | Fail-fast wave | In-flight tasks complete, ¬start new; checkpoint + stop; caller decides retry |
| Domain routing | Hardcoded const mapping | Simple, testable, sufficient for M04. Configurable routing future scope |
| Event wiring | Self-contained (emit + wire) | Use case subscribes JournalEventHandler + RecordTaskMetricsUseCase to EventBus |
| Resume | Built-in (single use case) | Checks for existing checkpoint on start; skips completed waves/tasks |
| Prompt artifacts | `src/resources/protocols/execute.md` | Compressed notation, top-level resources folder for all LLM artifacts |
| Cross-hexagon ports | `TaskRepositoryPort` ∧ `WaveDetectionPort` from task hex barrel | Standard dependency inversion per arch rules (§2 rule 2) |
| AgentType extension | Add `"executor"` to kernel `AgentTypeSchema` | Execution agents are a distinct type from reviewers/fixers |

## Design

### AgentType Extension

`AgentTypeSchema` (kernel) extended w/ `"executor"` variant for task execution agents.
`AgentCapabilitySchema` extended w/ `"execute"`.

```typescript
// kernel/agents/agent-card.schema.ts — MODIFIED
export const AgentTypeSchema = z.enum([
  "spec-reviewer", "code-reviewer", "security-auditor", "fixer",
  "executor",  // NEW — task execution agents dispatched by wave engine
]);

export const AgentCapabilitySchema = z.enum(["review", "fix", "execute"]);
```

### Input / Output

```typescript
export const ExecuteSliceInputSchema = z.object({
  sliceId: IdSchema,
  milestoneId: IdSchema,
  sliceLabel: z.string().min(1),       // e.g. "M04-S07"
  sliceTitle: z.string().min(1),       // e.g. "Wave-based execution engine"
  complexity: ComplexityTierSchema,
  model: ResolvedModelSchema,
  modelProfile: ModelProfileNameSchema,
  workingDirectory: z.string().min(1), // Worktree path (F-lite/F-full) or project root (S-tier)
});
export type ExecuteSliceInput = z.infer<typeof ExecuteSliceInputSchema>;

export const ExecuteSliceResultSchema = z.object({
  sliceId: IdSchema,
  completedTasks: z.array(IdSchema),
  failedTasks: z.array(IdSchema),
  skippedTasks: z.array(IdSchema),    // Stale-claimed tasks that were not dispatched
  wavesCompleted: z.number().int().nonnegative(),
  totalWaves: z.number().int().nonnegative(),
  aborted: z.boolean(),
});
export type ExecuteSliceResult = z.infer<typeof ExecuteSliceResultSchema>;
```

`workingDirectory` is caller-provided: for S-tier the caller passes the project root (`process.cwd()`), for F-lite/F-full the worktree path from `WorktreePort`. The use case validates worktree existence for non-S-tier but does ¬resolve the path itself.

### ExecuteSliceUseCase

```typescript
export class ExecuteSliceUseCase {
  constructor(private readonly deps: {
    taskRepository: TaskRepositoryPort;
    waveDetection: WaveDetectionPort;
    checkpointRepository: CheckpointRepositoryPort;
    agentDispatch: AgentDispatchPort;
    worktree: WorktreePort;
    eventBus: EventBusPort;
    journalRepository: JournalRepositoryPort;
    metricsRepository: MetricsRepositoryPort;
    dateProvider: DateProviderPort;
  }) {}

  async execute(input: ExecuteSliceInput): Promise<Result<ExecuteSliceResult, ExecutionError>>
}
```

#### Execute flow

```
execute(input):
  1. Load tasks → taskRepository.findBySliceId(input.sliceId)
     ¬tasks ∨ tasks.length = 0 ⇒ ExecutionError.noTasks
  2. Detect waves → waveDetection.detectWaves(tasks)
     cycle ⇒ ExecutionError.cyclicDependency
  3. Validate worktree:
     complexity ≠ 'S' ⇒ worktree.exists(sliceId)
       ¬exists ⇒ ExecutionError.worktreeRequired
     complexity = 'S' ⇒ no validation (caller provides project root in input.workingDirectory)
  4. Load OR create checkpoint:
     checkpointRepository.findBySliceId(sliceId)
     ∃ checkpoint ⇒ resume mode
     ¬checkpoint ⇒ Checkpoint.createNew(sliceId, baseCommit)
  5. Wire event subscriptions:
     JournalEventHandler → TASK_COMPLETED, TASK_BLOCKED, CHECKPOINT_SAVED, SLICE_STATUS_CHANGED
     RecordTaskMetricsUseCase → TASK_EXECUTION_COMPLETED
  6. ∀ wave ∈ waves (sequential):
     a. checkpoint.isWaveCompleted(waveIndex) ⇒ skip
     b. ∀ task ∈ wave: checkpoint.isTaskCompleted(taskId) ⇒ skip
     c. Detect stale claims:
        task.status = 'in_progress' ∧ (now - task.updatedAt) > 30min ⇒ warn, ¬dispatch
     d. Build AgentDispatchConfig per task via PromptBuilder
     e. Dispatch remaining tasks via Promise.allSettled
     f. Process settled results:
        - fulfilled ∧ status ∈ {DONE, DONE_WITH_CONCERNS}:
          task.complete() → checkpoint.recordTaskComplete(taskId)
          emit TaskCompletedEvent (task hex)
          emit TaskExecutionCompletedEvent (exec hex, carries AgentResult)
          checkpoint save
        - fulfilled ∧ status ∈ {BLOCKED, NEEDS_CONTEXT}:
          task.block() → emit TaskBlockedEvent
          emit TaskExecutionCompletedEvent → collect in failedTasks
        - rejected (dispatch error):
          collect in failedTasks
     g. failedTasks.length > 0 ⇒ break (fail-fast)
     h. checkpoint.advanceWave()
  7. All waves done ∧ ¬aborted ⇒ emit AllTasksCompletedEvent
  8. Return ExecuteSliceResult
```

### DomainRouter

```typescript
// execution/application/domain-router.ts

const ROUTE_TABLE: ReadonlyArray<{ pattern: RegExp; skills: readonly string[] }> = [
  { pattern: /\/(domain|entities)\//, skills: ['hexagonal-architecture'] },
  { pattern: /\/(application|use-case)\//, skills: ['hexagonal-architecture'] },
  { pattern: /\/(infrastructure|adapters?)\//, skills: ['hexagonal-architecture'] },
  { pattern: /\.spec\.ts$/, skills: ['test-driven-development'] },
];

const BASELINE_SKILLS: readonly string[] = ['executing-plans', 'commit-conventions'];
const MAX_SKILLS = 3;

export class DomainRouter {
  resolve(filePaths: readonly string[]): string[] {
    const matched = new Set<string>(BASELINE_SKILLS);
    for (const fp of filePaths) {
      for (const route of ROUTE_TABLE) {
        if (route.pattern.test(fp)) {
          route.skills.forEach(s => matched.add(s));
        }
      }
    }
    // Rigid skills first, then alphabetical. Max 3.
    return [...matched]
      .sort((a, b) => rigidFirst(a, b))
      .slice(0, MAX_SKILLS);
  }
}
```

### PromptBuilder

```typescript
// execution/application/prompt-builder.ts

export class PromptBuilder {
  constructor(
    private readonly config: {
      sliceId: string;
      sliceLabel: string;
      sliceTitle: string;
      milestoneId: string;
      workingDirectory: string;
      model: { provider: string; modelId: string };
      complexity: ComplexityTier;
    },
    private readonly router: DomainRouter,
  ) {}

  build(task: TaskDTO): AgentDispatchConfig {
    const skills = this.router.resolve(task.filePaths);
    return {
      taskId:           task.id,
      sliceId:          this.config.sliceId,
      agentType:        'executor',
      workingDirectory: this.config.workingDirectory,
      systemPrompt:     this.buildSystemPrompt(skills),
      taskPrompt:       this.buildTaskPrompt(task),
      model:            this.config.model,
      tools:            ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      filePaths:        task.filePaths,
    };
  }

  // systemPrompt: skill .md files wrapped in <skill> XML + AGENT_STATUS_PROMPT
  // taskPrompt: loads src/resources/protocols/execute.md, interpolates task fields
  // All prose uses compressed notation (∀, ⇒, ¬, ∧, ∨)
}
```

### Execution Protocol Template

New file: `src/resources/protocols/execute.md` — compressed notation:

```markdown
EXECUTING — {{sliceLabel}}: {{sliceTitle}}.

## Context
- Task: {{taskLabel}} — {{taskTitle}}
- Slice: {{sliceId}} ({{complexity}})
- Dir: {{workingDirectory}}

## Instructions
∀ AC: implement ∧ verify.
TDD: RED ⇒ GREEN ⇒ REFACTOR ⇒ commit.
Commit: `<type>({{sliceLabel}}/{{taskLabel}}): <summary>`

## Task
{{taskDescription}}

## AC
{{#acceptanceCriteria}}
{{index}}. {{criterion}}
{{/acceptanceCriteria}}

## Files
{{#filePaths}}
- `{{path}}`
{{/filePaths}}

## Status
∀ completion: emit report between `<!-- TFF_STATUS_REPORT -->` markers.
¬DONE ∧ ∃ concerns ⇒ DONE_WITH_CONCERNS.
```

### AllTasksCompletedEvent

```typescript
// execution/domain/events/all-tasks-completed.event.ts

const AllTasksCompletedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  milestoneId: IdSchema,
  completedTaskCount: z.number().int().nonnegative(),
  totalWaveCount: z.number().int().positive(),
});

export class AllTasksCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.ALL_TASKS_COMPLETED;
}
```

### ExecutionError

```typescript
// execution/domain/errors/execution.error.ts

export class ExecutionError extends BaseDomainError {
  readonly code: string;

  static noTasks(sliceId: string): ExecutionError
  static cyclicDependency(sliceId: string): ExecutionError
  static worktreeRequired(sliceId: string): ExecutionError
  static waveFailed(sliceId: string, waveIndex: number, failedTaskIds: string[]): ExecutionError
  static staleClaim(taskId: string): ExecutionError
}
```

Error codes: `EXECUTION.NO_TASKS`, `EXECUTION.CYCLIC_DEPENDENCY`, `EXECUTION.WORKTREE_REQUIRED`, `EXECUTION.WAVE_FAILED`, `EXECUTION.STALE_CLAIM`.

### Stale Claim Detection

```typescript
const STALE_CLAIM_TTL_MS = 30 * 60 * 1000; // 30 min

// task.status = 'in_progress' ∧ (now - task.updatedAt) > STALE_CLAIM_TTL_MS
// ⇒ warn (log), ¬dispatch, collect in skippedTasks
// Edge case: ∀ task ∈ wave stale ⇒ wave advances w/ zero work, skippedTasks populated.
// Caller inspects skippedTasks to decide escalation.
```

## File Inventory

### New Files

| File | Purpose |
|---|---|
| `src/resources/protocols/execute.md` | Execution protocol template (compressed notation) |
| `src/hexagons/execution/application/execute-slice.use-case.ts` | Core wave-loop orchestrator |
| `src/hexagons/execution/application/execute-slice.use-case.spec.ts` | Use case tests |
| `src/hexagons/execution/application/execute-slice.schemas.ts` | Input/Result Zod schemas |
| `src/hexagons/execution/application/execute-slice.schemas.spec.ts` | Schema tests |
| `src/hexagons/execution/application/domain-router.ts` | File paths → skill names mapping |
| `src/hexagons/execution/application/domain-router.spec.ts` | Domain router tests |
| `src/hexagons/execution/application/prompt-builder.ts` | Task → AgentDispatchConfig assembly |
| `src/hexagons/execution/application/prompt-builder.spec.ts` | Prompt builder tests |
| `src/hexagons/execution/domain/errors/execution.error.ts` | ExecutionError w/ static factories |
| `src/hexagons/execution/domain/errors/execution.error.spec.ts` | Error tests |
| `src/hexagons/execution/domain/events/all-tasks-completed.event.ts` | AllTasksCompletedEvent |
| `src/hexagons/execution/domain/events/all-tasks-completed.event.spec.ts` | Event tests |

### Modified Files

| File | Change |
|---|---|
| `src/kernel/agents/agent-card.schema.ts` | Add `"executor"` to `AgentTypeSchema`, `"execute"` to `AgentCapabilitySchema` |
| `src/kernel/agents/agent-card.schema.spec.ts` | Add tests for new enum values |
| `src/hexagons/execution/index.ts` | Export new use case, schemas, event, error, collaborators |

## Acceptance Criteria

- [ ] AC1: Tasks within a wave execute in parallel (`Promise.allSettled`); waves execute sequentially
- [ ] AC2: If checkpoint exists for sliceId, completed waves ∧ completed tasks within current wave are skipped (resume)
- [ ] AC3: On task failure (BLOCKED/NEEDS_CONTEXT), in-flight tasks complete but ¬further waves start. `aborted = true`
- [ ] AC4: `DomainRouter.resolve(filePaths)` maps `domain/`/`application/`/`infrastructure/` → `hexagonal-architecture`; `.spec.ts` → `test-driven-development`; baseline = `executing-plans` + `commit-conventions`. Max 3 skills
- [ ] AC5: After each dispatch, both `TaskCompletedEvent`/`TaskBlockedEvent` (task hex) ∧ `TaskExecutionCompletedEvent` (exec hex) emitted
- [ ] AC6: `AllTasksCompletedEvent` emitted iff all waves complete ∧ ¬aborted
- [ ] AC7: Tasks w/ status `in_progress` for >30min detected, logged, ¬dispatched, collected in `skippedTasks`
- [ ] AC8: `JournalEventHandler` ∧ `RecordTaskMetricsUseCase` subscribed to EventBus before dispatch
- [ ] AC9: Slices w/ complexity ≠ `'S'` require existing worktree; ¬worktree → `ExecutionError.worktreeRequired`
- [ ] AC10: Checkpoint saved after each task completion ∧ after each wave advance
- [ ] AC11: `src/resources/protocols/execute.md` exists as canonical template w/ interpolation variables ∧ logic symbols (`∀`, `⇒`, `¬`). `PromptBuilder` accepts template content as constructor param ∧ interpolates task fields
- [ ] AC12: `PromptBuilder` produces `AgentDispatchConfig` w/ `agentType: 'executor'`, domain-routed skills in `systemPrompt`, ∧ interpolated task prompt. `AGENT_STATUS_PROMPT` is appended by PI adapter (¬by PromptBuilder)

## Non-Goals

- `/tff:execute` command wiring (S10)
- Async overseer / watchdog (S09)
- Budget enforcement / model downshift
- Migration of existing workflow templates to `src/resources/`
- Per-task worktree management (per-slice only)

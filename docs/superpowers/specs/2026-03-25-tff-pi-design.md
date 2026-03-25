# The Forge Flow PI -- Design Specification

## 1. Project Identity

**The Forge Flow PI (TFF-PI)** is a standalone CLI tool and PI extension that orchestrates AI agents through a structured software development lifecycle. It is a full port of [The-Forge-Flow-CC](https://github.com/MonsieurBarti/The-Forge-Flow-CC) (a Claude Code plugin) rebuilt on top of the [PI SDK](https://github.com/badlogic/pi-mono) with strict hexagonal architecture.

### Goals

- Full feature parity with TFF-CC: project lifecycle, milestones, slices, tasks, wave-based parallelism, skills, auto-learn, code review, checkpoint/resume
- Strict hexagonal architecture where each feature module is its own hexagon (pattern hive)
- Zod-first type system: all types defined as Zod schemas, inferred as TypeScript types
- Rich domain classes with business methods (Naboo pattern)
- Standalone CLI (`tff`) AND installable as PI extensions into vanilla `pi` CLI
- Compatible with PI's full extension ecosystem (plannotator, GitHub, etc.)

### Non-Goals

- Beads/Dolt integration (dropped -- SQLite + git orphan branch instead)
- Dolt remote sync (team collaboration via git orphan branch)
- Custom UI framework (uses PI's `pi-tui` and extension ecosystem)

## 2. Architecture Overview

### Deployment Model

Hybrid -- following the GSD-2 pattern:
- `npm install -g @the-forge-flow/cli` installs the `tff` binary (PI coding agent + TFF extensions pre-loaded)
- TFF extensions are also installable into vanilla `pi` CLI
- Compatible with any PI extension (plannotator, GitHub, voice, etc.)

### Package Structure

Single npm package with physical hexagon folders. Lint-enforced boundaries via barrel exports.

```
the-forge-flow-pi/
  package.json
  tsconfig.json
  biome.json
  vitest.config.ts
  src/
    kernel/                          # Shared DDD building blocks
    hexagons/                        # The pattern hive
      project/
      milestone/
      slice/
      task/
      execution/
      review/
      intelligence/
      settings/
      workflow/
    infrastructure/                  # Cross-cutting adapters
      pi/                            # PI SDK extension wiring
      git/                           # Git CLI + orphan branch sync
      github/                        # GitHub (gh CLI) adapter
    cli/                             # Entry point (two-file loader)
  dist/
```

### Architectural Rules

1. Hexagons import only from `kernel/` and their own internals -- never from other hexagons' internals directly
2. **Cross-hexagon queries:** Hexagons MAY depend on other hexagons' **ports** (exported via barrel) through dependency inversion. The consuming hexagon defines a port matching what it needs; the other hexagon's adapter implements it. This is standard hexagonal -- ports are contracts, not internals.
3. **Cross-hexagon notifications:** Fire-and-forget communication via domain events through an `EventBusPort`. Event handlers run **sequentially in subscription order** (not concurrently) to avoid race conditions.
4. Each hexagon exports a public barrel (`index.ts`) -- only ports, events, and DTOs. Never entities or internal services.
5. Infrastructure adapters implement ports defined in hexagons.
6. Workflow hexagon orchestrates but does not own -- it drives transitions by consuming events and invoking other hexagons through their ports.
7. Every hexagon works standalone -- usable outside workflow context via its public API.

## 3. Kernel (Shared DDD Building Blocks)

### Schemas

```typescript
// kernel/schemas.ts
export const IdSchema = z.string().uuid();
export type Id = z.infer<typeof IdSchema>;

export const TimestampSchema = z.coerce.date();
export type Timestamp = z.infer<typeof TimestampSchema>;
```

### Result Type

```typescript
// kernel/result.ts
export type Result<T, E> = { ok: true; data: T } | { ok: false; error: E };
```

No exceptions for domain errors. All fallible operations return `Result<T, E>`.

### Base Classes

```typescript
// kernel/entity.base.ts
export abstract class Entity<TProps> {
  protected constructor(protected props: TProps) {}
  abstract get id(): string;
  toJSON(): TProps { return { ...this.props }; }
}

// kernel/aggregate-root.base.ts
export abstract class AggregateRoot<TProps> extends Entity<TProps> {
  private domainEvents: DomainEvent[] = [];
  protected addEvent(event: DomainEvent): void { this.domainEvents.push(event); }
  pullEvents(): DomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents = [];
    return events;
  }
}

// kernel/value-object.base.ts
export abstract class ValueObject<TProps> {
  protected constructor(protected readonly props: TProps) {}
  equals(other: ValueObject<TProps>): boolean { /* structural JSON comparison */ }
}

// kernel/domain-event.base.ts
export const DomainEventPropsSchema = z.object({
  id: IdSchema,
  aggregateId: IdSchema,
  occurredAt: TimestampSchema,
  correlationId: IdSchema.optional(),
  causationId: IdSchema.optional(),
});
export type DomainEventProps = z.infer<typeof DomainEventPropsSchema>;

export abstract class DomainEvent {
  abstract readonly eventName: string;
  constructor(public readonly props: DomainEventProps) {}
}
```

### Ports

```typescript
// kernel/ports/event-bus.port.ts
export abstract class EventBusPort {
  abstract publish(event: DomainEvent): Promise<void>;
  abstract subscribe<T extends DomainEvent>(
    eventType: string,
    handler: (event: T) => Promise<void>
  ): void;
}

// kernel/ports/date-provider.port.ts
export abstract class DateProviderPort {
  abstract now(): Date;
}

// kernel/ports/git.port.ts
export abstract class GitPort {
  abstract listBranches(pattern: string): Promise<Result<string[], GitError>>;
  abstract createBranch(name: string, base: string): Promise<Result<void, GitError>>;
  abstract showFile(branch: string, path: string): Promise<Result<string | null, GitError>>;
  abstract log(branch: string, limit?: number): Promise<Result<GitLogEntry[], GitError>>;
  abstract status(): Promise<Result<GitStatus, GitError>>;
  abstract commit(message: string, paths: string[]): Promise<Result<string, GitError>>;
}

// kernel/ports/github.port.ts
export abstract class GitHubPort {
  abstract createPullRequest(config: PullRequestConfig): Promise<Result<PullRequestInfo, GitHubError>>;
  abstract listPullRequests(filter?: PrFilter): Promise<Result<PullRequestInfo[], GitHubError>>;
  abstract addComment(prNumber: number, body: string): Promise<Result<void, GitHubError>>;
}

// kernel/ports/state-sync.port.ts
export abstract class StateSyncPort {
  abstract push(): Promise<Result<void, SyncError>>;
  abstract pull(): Promise<Result<SyncReport, SyncError>>;
  abstract markDirty(): Promise<void>;
}
```

### Domain Error Base

```typescript
// kernel/errors/base-domain.error.ts
export abstract class BaseDomainError extends Error {
  abstract readonly code: string;
  readonly metadata?: Record<string, unknown>;
}

// kernel/errors/persistence.error.ts
export class PersistenceError extends BaseDomainError {
  readonly code = 'PERSISTENCE.FAILURE';
  constructor(message: string, public readonly cause?: unknown) { super(message); }
}

// kernel/errors/git.error.ts
export class GitError extends BaseDomainError {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = `GIT.${code}`; }
}

// kernel/errors/github.error.ts
export class GitHubError extends BaseDomainError {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = `GITHUB.${code}`; }
}

// kernel/errors/sync.error.ts
export class SyncError extends BaseDomainError {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = `SYNC.${code}`; }
}
```

### Event Name Type Safety

Event names are `as const` string literals to prevent typo-based subscription failures:

```typescript
// kernel/event-names.ts
export const EVENT_NAMES = {
  PROJECT_INITIALIZED: 'project.initialized',
  MILESTONE_CREATED: 'milestone.created',
  MILESTONE_CLOSED: 'milestone.closed',
  SLICE_CREATED: 'slice.created',
  SLICE_STATUS_CHANGED: 'slice.status-changed',
  TASK_COMPLETED: 'task.completed',
  TASK_BLOCKED: 'task.blocked',
  ALL_TASKS_COMPLETED: 'execution.all-tasks-completed',
  REVIEW_RECORDED: 'review.recorded',
  SKILL_REFINED: 'intelligence.skill-refined',
  WORKFLOW_PHASE_CHANGED: 'workflow.phase-changed',
} as const;

export type EventName = typeof EVENT_NAMES[keyof typeof EVENT_NAMES];
```

Events use these constants for both `eventName` and subscription keys.

## 4. Hexagon Structure (Pattern Per Module)

Every hexagon follows this structure. Tests live alongside the files they test.

```
hexagons/<name>/
  index.ts                                # Public barrel (ports, events, DTOs)
  domain/
    <name>.entity.ts                      # Aggregate root
    <name>.entity.spec.ts
    <name>.builder.ts                     # Faker-based test builder
    <name>.schemas.ts                     # Zod schemas (source of truth)
    <value-object>.value-object.ts
    <value-object>.value-object.spec.ts
    errors/
      <name>-base.error.ts               # Abstract base for this hexagon
      <specific>.error.ts
    events/
      <name>-<action>.event.ts
    ports/
      <name>.repository.port.ts
  application/
    <action>-<name>.use-case.ts
    <action>-<name>.use-case.spec.ts      # Uses builder + in-memory adapter
  infrastructure/
    sqlite-<name>.repository.ts
    sqlite-<name>.repository.spec.ts
    in-memory-<name>.repository.ts
    in-memory-<name>.repository.spec.ts
```

## 5. Hexagons

### 5.1 Project Hexagon

**Aggregate:** `Project` (singleton per repo)

**Schemas:**
```typescript
export const ProjectPropsSchema = z.object({
  id: IdSchema,
  name: z.string(),
  vision: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
```

**Business Methods:** `init()`, `updateVision()`

**Domain Events:** `ProjectInitializedEvent`

### 5.2 Milestone Hexagon

**Aggregate:** `Milestone`

**Schemas:**
```typescript
export const MilestoneStatusSchema = z.enum(['open', 'in_progress', 'closed']);

export const MilestonePropsSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  label: z.string(),                     // "M01"
  title: z.string(),
  description: z.string().optional(),
  status: MilestoneStatusSchema,
  branch: z.string(),                    // "milestone/M01"
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
```

**Business Methods:** `createNew()`, `activate()`, `close()`

**Domain Events:** `MilestoneCreatedEvent`, `MilestoneClosedEvent`

### 5.3 Slice Hexagon

**Aggregate:** `Slice`

**Value Objects:** `SliceStatusVO` (state machine with allowed transitions)

**Schemas:**
```typescript
export const SliceStatusSchema = z.enum([
  'discussing', 'researching', 'planning', 'executing',
  'verifying', 'reviewing', 'completing', 'closed'
]);

export const ComplexityTierSchema = z.enum(['S', 'F-lite', 'F-full']);

export const SlicePropsSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema,
  label: z.string(),                     // "M01-S01"
  title: z.string(),
  description: z.string().optional(),
  status: SliceStatusSchema,
  complexity: ComplexityTierSchema,
  specPath: z.string().optional(),
  planPath: z.string().optional(),
  researchPath: z.string().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
```

**State Machine Transitions:**
```
discussing  → researching, planning
researching → planning
planning    → executing, planning (replan loop)
executing   → verifying
verifying   → executing (fail → re-execute), reviewing
reviewing   → executing (fail → re-execute), completing
completing  → closed
```

**Business Methods:** `createNew()`, `transitionTo()`, `classify()`

**Domain Events:** `SliceCreatedEvent`, `SliceStatusChangedEvent`

**Errors:** `InvalidTransitionError`, `SliceNotFoundError`

### 5.4 Task Hexagon

**Aggregate:** `Task`

**Value Objects:** `Wave` (topologically-sorted group of tasks)

**Schemas:**
```typescript
export const TaskStatusSchema = z.enum(['open', 'in_progress', 'closed', 'blocked']);

export const TaskPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  label: z.string(),                     // "T01"
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  filePaths: z.array(z.string()),
  status: TaskStatusSchema,
  blockedBy: z.array(IdSchema),
  waveIndex: z.number().int().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const WaveSchema = z.object({
  index: z.number().int().min(0),
  taskIds: z.array(IdSchema),
});
```

**Business Methods:** `createNew()`, `complete()`, `block()`, `unblock()`, `assignToWave()`

**Use Cases:** `DetectWavesUseCase` (Kahn's algorithm -- topological sort with cycle detection)

**Domain Events:** `TaskCompletedEvent`, `TaskBlockedEvent`

**Errors:** `CyclicDependencyError`, `TaskNotFoundError`

### 5.5 Execution Hexagon

**Aggregate:** `Checkpoint`

**Schemas:**
```typescript
export const CheckpointPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  baseCommit: z.string(),
  currentWaveIndex: z.number().int(),
  completedWaves: z.array(z.number().int()),
  completedTasks: z.array(IdSchema),
  executorLog: z.array(z.object({
    taskId: IdSchema,
    agentIdentity: z.string(),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
  })),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
```

**Business Methods:** `recordTaskStart()`, `recordTaskComplete()`, `advanceWave()`, `isTaskCompleted()`, `isWaveCompleted()`

**Ports:**

```typescript
// hexagons/execution/domain/ports/agent-dispatch.port.ts
export const AgentDispatchConfigSchema = z.object({
  taskId: IdSchema,
  sliceId: IdSchema,
  workingDirectory: z.string(),
  systemPrompt: z.string(),           // skill markdown injected here
  taskPrompt: z.string(),             // task description + acceptance criteria
  model: z.object({
    provider: z.string(),
    modelId: z.string(),
  }),
  tools: z.array(z.string()),         // tool names to enable
  filePaths: z.array(z.string()),     // files to pre-load in context
});
export type AgentDispatchConfig = z.infer<typeof AgentDispatchConfigSchema>;

export const AgentResultSchema = z.object({
  taskId: IdSchema,
  success: z.boolean(),
  output: z.string(),                 // agent's final output
  filesChanged: z.array(z.string()),
  cost: z.object({
    provider: z.string(),
    modelId: z.string(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costUsd: z.number(),
  }),
  agentIdentity: z.string(),
  durationMs: z.number().int(),
  error: z.string().optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

export abstract class AgentDispatchPort {
  abstract dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>>;
  abstract abort(taskId: string): Promise<void>;
}

// hexagons/execution/domain/ports/worktree.port.ts
export abstract class WorktreePort {
  abstract create(branch: string, baseBranch: string, path: string): Promise<Result<string, GitError>>;
  abstract delete(branch: string): Promise<Result<void, GitError>>;
  abstract list(): Promise<Result<WorktreeInfo[], GitError>>;
  abstract exists(branch: string): Promise<boolean>;
}
// Lifecycle: created per-slice (not per-task). One worktree per slice branch.
// Cleanup: on slice close or explicit /tff:rollback.
```

**Use Cases:** `ExecuteSliceUseCase` (wave-based parallel dispatch with checkpoint recovery)

**Dispatch Flow:**
1. Load slice + tasks
2. Detect waves via `WaveDetectionPort` (implemented by task hexagon's adapter)
3. Load or create checkpoint
4. For each wave (sequential): dispatch tasks in parallel via `AgentDispatchPort`, checkpoint after each task completion
5. Emit `AllTasksCompletedEvent`

**Concurrency Model:** The orchestrator (parent process) owns the single SQLite connection. Agents run in worktrees and communicate results back through `AgentDispatchPort`. Agents never write to SQLite directly.

**Cost Tracking:**
```typescript
export const CostEntrySchema = z.object({
  taskId: IdSchema,
  sliceId: IdSchema,
  milestoneId: IdSchema,
  provider: z.string(),
  modelId: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cost: z.number(),
  timestamp: TimestampSchema,
});
```

### 5.6 Review Hexagon

**Aggregate:** `Review`

**Schemas:**
```typescript
export const ReviewVerdictSchema = z.enum(['approved', 'changes_requested', 'rejected']);
export const ReviewRoleSchema = z.enum(['code-reviewer', 'spec-reviewer', 'security-auditor']);

export const ReviewPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  role: ReviewRoleSchema,
  agentIdentity: z.string(),
  verdict: ReviewVerdictSchema,
  findings: z.array(z.object({
    severity: z.enum(['critical', 'major', 'minor', 'suggestion']),
    description: z.string(),
    filePath: z.string().optional(),
    lineRange: z.object({ start: z.number(), end: z.number() }).optional(),
  })),
  createdAt: TimestampSchema,
});
```

**Business Methods:** `record()`, `enforceFreshReviewer()` (reviewer !== executor for that slice)

**Ports:**

```typescript
// hexagons/review/domain/ports/review-ui.port.ts
export abstract class ReviewUIPort {
  // Present review findings to the user and collect verdict
  abstract presentFindings(findings: ReviewFinding[]): Promise<Result<ReviewVerdict, ReviewUIError>>;
  // Present a plan/spec for human approval
  abstract presentForApproval(artifact: { title: string; content: string; path: string }): Promise<Result<ApprovalResult, ReviewUIError>>;
}
// Default adapter: terminal (pi-tui). Optional: plannotator PI extension (auto-detected).

// hexagons/review/domain/ports/executor-query.port.ts
// Cross-hexagon port: Review needs to know who executed a slice (from Execution hexagon)
export abstract class ExecutorQueryPort {
  abstract getExecutors(sliceId: string): Promise<Result<string[], PersistenceError>>;
}
```

**Use Cases:** `ConductReviewUseCase` (3-stage: spec compliance, code quality, security audit). Uses `ExecutorQueryPort` to enforce fresh-reviewer constraint without reaching into Execution hexagon internals.

**Domain Events:** `ReviewRecordedEvent`

**Errors:** `FreshReviewerViolationError`

### 5.7 Intelligence Hexagon

**Aggregates:** `Skill`, `Observation`, `Pattern`, `Candidate`

**Schemas (Skill):**
```typescript
export const SkillPropsSchema = z.object({
  id: IdSchema,
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z.string(),
  type: z.enum(['rigid', 'flexible']),
  markdown: z.string(),
  enforcerRules: z.array(z.object({
    name: z.string(),
    check: z.string(),
  })).optional(),
  version: z.number().int().positive(),
  driftPct: z.number().min(0).max(100).default(0),
  lastRefinedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
```

**Skills:** Layered approach -- markdown for LLM guidance + `SkillEnforcer` for programmatic validation. 18 methodology skills ported from TFF-CC.

**Auto-Learn Pipeline:**
1. `ExtractNgramsUseCase` -- sliding window over observation sequences
2. `RankCandidatesUseCase` -- weighted scoring (frequency, breadth, recency, consistency)
3. `CreateSkillUseCase` -- draft skill from candidate (requires >=3 session evidence)
4. `RefineSkillUseCase` -- bounded refinement (max 20% per change, 60% cumulative, 7-day cooldown)
5. `DetectClustersUseCase` -- co-activated skill bundles (Jaccard distance)

**Skill Business Methods:** `refine()`, `checkDrift()`

**Guardrails:** Min 3 corrections, 7-day cooldown, max 20% drift per refinement, 60% cumulative

### 5.8 Settings Hexagon

**Aggregate:** `ProjectSettings`

**Schemas:**
```typescript
export const ModelProfileNameSchema = z.enum(['quality', 'balanced', 'budget']);
export type ModelProfileName = z.infer<typeof ModelProfileNameSchema>;

export const ModelProfileSchema = z.object({
  name: ModelProfileNameSchema,
  provider: z.string(),
  modelId: z.string(),
});

export const ModelRoutingConfigSchema = z.object({
  profiles: z.record(ModelProfileNameSchema, ModelProfileSchema),
  phaseOverrides: z.record(WorkflowPhaseSchema, ModelProfileNameSchema).optional(),
  complexityMapping: z.object({
    S: ModelProfileNameSchema,
    'F-lite': ModelProfileNameSchema,
    'F-full': ModelProfileNameSchema,
  }),
  budget: z.object({
    ceiling: z.number().positive().optional(),
    enforcement: z.enum(['pause', 'warn', 'hard-stop']),
    downshiftThresholds: z.object({
      toBalanced: z.number().min(0).max(1),
      toBudget: z.number().min(0).max(1),
    }),
  }).optional(),
  fallbackChains: z.record(z.string(), z.array(z.string())).optional(),
});

export const SettingsSchema = z.object({
  modelRouting: ModelRoutingConfigSchema,
  autonomy: z.object({
    mode: z.enum(['guided', 'plan-to-pr']),
    maxRetries: z.number().int().min(0).default(2),
  }),
  autoLearn: z.object({
    weights: z.object({
      frequency: z.number().default(0.25),
      breadth: z.number().default(0.30),
      recency: z.number().default(0.25),
      consistency: z.number().default(0.20),
    }),
    guardrails: z.object({
      minCorrections: z.number().int().default(3),
      cooldownDays: z.number().int().default(7),
      maxDriftPct: z.number().default(20),
    }),
  }),
  persistence: z.object({
    gitignore: z.enum(['full', 'state-only', 'none']).default('full'),
  }),
});
```

**Settings Cascade:** Hardcoded defaults (Zod `.default()`) < `tff-state` branch `settings.yaml` (team) < `.tff/settings.yaml` (local) < environment variables

**YAML Validation Strategy:** Settings files are parsed with `safeParse()`. On invalid data: log a warning with the specific validation errors, fall back to defaults for the invalid fields only (not the entire file), and continue. This matches TFF-CC's resilient settings parsing -- every field has a Zod `.default()` so partial configs always produce a valid `Settings` object.

**Use Cases:** `ResolveModelUseCase` (phase + complexity + budget → concrete model), `LoadSettingsUseCase`, `MergeSettingsUseCase`

### 5.9 Workflow Hexagon

**Role:** Orchestrator. Owns the workflow session state machine. Delegates all real work to other hexagons.

**Relationship between Workflow Phase and Slice Status:**

The workflow and slice have **separate but synchronized** state machines:
- **Slice status** = artifact lifecycle (what state is the slice's work in?)
- **Workflow phase** = orchestration session (what is the workflow doing right now?)

The workflow phase is the **driver**. When the workflow transitions, it triggers the corresponding slice transition. The mapping:

| Workflow Phase | Slice Status | Extra Workflow Concerns |
|---|---|---|
| `idle` | (no active slice) | Selecting next slice |
| `discussing` | `discussing` | -- |
| `researching` | `researching` | -- |
| `planning` | `planning` | Human gate: plan approval |
| `executing` | `executing` | Wave dispatch, checkpoints |
| `verifying` | `verifying` | Acceptance criteria validation |
| `reviewing` | `reviewing` | Fresh-reviewer enforcement |
| `shipping` | `completing` | PR creation, merge |
| `completing-milestone` | (all slices `closed`) | Milestone audit, merge to main |
| `paused` | (unchanged) | Saves previous phase for resume |
| `blocked` | (unchanged) | Escalation |

When `shipping` completes, the slice transitions to `closed` and the workflow returns to `idle` for the next slice.

**Aggregate: `WorkflowSession`**

```typescript
export const WorkflowPhaseSchema = z.enum([
  'idle', 'discussing', 'researching', 'planning',
  'executing', 'verifying', 'reviewing',
  'shipping', 'completing-milestone',
  'paused', 'blocked'
]);
export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;

export const WorkflowTriggerSchema = z.enum([
  'start', 'next', 'skip', 'back', 'fail',
  'approve', 'reject', 'pause', 'resume', 'abort'
]);
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;

export const WorkflowSessionPropsSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema,
  sliceId: IdSchema.optional(),           // null when idle
  currentPhase: WorkflowPhaseSchema,
  previousPhase: WorkflowPhaseSchema.optional(),  // for pause/resume
  retryCount: z.number().int().min(0).default(0),
  autonomyMode: z.enum(['guided', 'plan-to-pr']),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type WorkflowSessionProps = z.infer<typeof WorkflowSessionPropsSchema>;
```

**Cardinality:** One `WorkflowSession` per milestone. The session tracks which slice is active and what phase it's in. When a slice completes, `sliceId` clears and phase returns to `idle`.

**Business Methods:** `trigger(trigger, guardContext)`, `assignSlice(sliceId)`, `clearSlice()`

**State Machine:** Declarative transition table with named guard functions. Not if-else chains.

**Transitions:**
```
idle        + start   → discussing
discussing  + next    → researching  (guard: notSTier)
discussing  + next    → planning     (guard: isSTier)
discussing  + skip    → planning
researching + next    → planning
planning    + approve → executing    (human gate)
planning    + reject  → planning     (replan, retryCount++)
executing   + next    → verifying
verifying   + approve → reviewing
verifying   + reject  → executing    (retryCount++)
reviewing   + approve → shipping     (human gate)
reviewing   + reject  → executing    (retryCount++)
shipping    + next    → idle         (slice → closed)
idle        + next    → completing-milestone  (guard: allSlicesClosed)
Any active  + fail    → blocked      (guard: retriesExhausted)
Any active  + pause   → paused       (saves previousPhase)
paused      + resume  → previousPhase
```

When `retryCount` exceeds `settings.autonomy.maxRetries` (default 2), the workflow transitions to `blocked` and escalates to the human.

**Autonomy Modes:**
- `guided` -- pauses at every transition for human approval
- `plan-to-pr` -- auto-advances non-gate phases. Human gates: plan approval (`planning + approve`), review approval (`reviewing + approve`), ship approval. Max 2 retry cycles before escalation.

**Event-Driven Orchestration:**

The workflow orchestrator is the central coordinator. It does NOT rely on multiple hexagons independently subscribing to the same event. Instead, for flows that require ordering, the workflow explicitly calls use cases in sequence:

```
Workflow triggers 'executing':
  1. workflow calls slice.transitionTo('executing')
  2. workflow calls task.detectWaves(sliceId) → waves
  3. workflow calls execution.beginDispatch(sliceId, waves)
  (Sequential, no race condition)

TaskCompletedEvent (from execution hexagon):
  → workflow: checks if all tasks done → trigger 'next'

ReviewRecordedEvent (from review hexagon):
  → workflow: if verdict approved → trigger 'approve'
```

Domain events are used for **notifications** (fire-and-forget). Synchronous cross-hexagon queries go through **ports** (explicit calls).

**Domain Events:** `WorkflowPhaseChangedEvent`

**Standalone Use:** Each hexagon works independently outside the workflow. You can dispatch a code review agent, run a skill enforcer, or detect waves without an active workflow session.

## 6. PI SDK Integration

### Extension Architecture

Each hexagon that exposes user-facing functionality contributes a PI extension:

```typescript
// Each extension registers tools, commands, and event handlers via ExtensionAPI
export const tffWorkflowExtension: ExtensionFactory = (api: ExtensionAPI) => {
  api.registerCommand({ name: 'tff', ... });
  api.registerCommand({ name: 'tff:auto', ... });
  api.registerCommand({ name: 'tff:status', ... });
  // ...
  return { name: 'tff-workflow', version: '0.1.0' };
};
```

### Zod-to-JSON-Schema Adapter

PI SDK tools use TypeBox. TFF uses Zod. Bridge at the boundary.

**Constraint:** Tool parameter schemas (those passed through `createZodTool`) must use only JSON-Schema-compatible Zod features: `z.object()`, `z.string()`, `z.number()`, `z.boolean()`, `z.enum()`, `z.array()`, `z.optional()`, `z.default()`. No `.transform()`, `.pipe()`, `.preprocess()`, `.brand()`, or `.refine()` in tool schemas -- those features lose semantics in JSON Schema conversion. Transforms and refinements are fine in internal domain schemas that never cross the PI SDK boundary.

```typescript
// infrastructure/pi/zod-tool.adapter.ts
export function createZodTool<T extends z.ZodType>(config: {
  name: string;
  label: string;
  description: string;
  schema: T;
  execute: (args: z.infer<T>, signal: AbortSignal) => Promise<AgentToolResult>;
}): AgentTool {
  return {
    name: config.name,
    label: config.label,
    description: config.description,
    parameters: zodToJsonSchema(config.schema) as TObject,
    execute: async (rawArgs, signal, update) => {
      const parsed = config.schema.safeParse(rawArgs);
      if (!parsed.success) {
        return { content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }] };
      }
      return config.execute(parsed.data, signal);
    },
  };
}
```

### Agent Dispatch

Fresh subagent per task via PI SDK's `createAgentSession()`:

```typescript
// hexagons/execution/infrastructure/pi/agent-dispatch.adapter.ts
export class PiAgentDispatchAdapter implements AgentDispatchPort {
  async dispatch(config: AgentDispatchConfig): Promise<AgentResult> {
    const { session } = await createAgentSession({
      cwd: config.workingDirectory,
      model: config.model,
      tools: config.tools,
      systemPrompt: config.systemPrompt,  // skill markdown injected here
    });
    await session.prompt(config.taskPrompt);
    return { /* collected from session events */ };
  }
}
```

### Skills as PI Skills

TFF's 18 methodology skills are standard PI skills (`SKILL.md` files) loaded via PI's skill discovery. Plus `SkillEnforcer` classes in the intelligence hexagon for programmatic validation.

**Skill Injection Contract:**

When dispatching an agent, the system prompt includes only **phase-relevant skills**, not all 18. Mapping:

| Phase/Role | Skills Injected |
|---|---|
| Discussing | brainstorming |
| Researching | (none -- free-form exploration) |
| Planning | writing-plans, stress-testing-specs |
| Executing (dev) | test-driven-development, hexagonal-architecture, commit-conventions |
| Executing (debug) | systematic-debugging |
| Verifying | acceptance-criteria-validation, verification-before-completion |
| Reviewing (code) | code-review-protocol |
| Reviewing (security) | code-review-protocol (security focus) |
| Reviewing (spec) | architecture-review |
| Shipping | finishing-work, commit-conventions |

Skills are injected as XML-wrapped markdown sections in the system prompt (PI's standard format). Total injection is bounded -- max 3 skills per dispatch to control token cost. If a phase maps to more skills, they're prioritized by skill type (rigid first).

### Command Mapping

All 30 TFF-CC commands become PI slash commands: `/tff:new`, `/tff:discuss`, `/tff:plan`, `/tff:execute`, `/tff:verify`, `/tff:ship`, `/tff:status`, `/tff:quick`, `/tff:debug`, `/tff:settings`, `/tff:suggest`, `/tff:skill:new`, `/tff:learn`, `/tff:patterns`, `/tff:compose`, etc.

## 7. Persistence & State Management

### Single Home

All TFF state lives in `.tff/` at project root. Always gitignored.

```
.tff/
  state.db                     # SQLite: status, deps, transitions
  settings.yaml                # Local settings overrides
  journal.jsonl                # Append-only mutation journal
  PROJECT.md                   # Project vision
  milestones/
    M01/
      REQUIREMENTS.md
      slices/
        M01-S01/
          SPEC.md
          PLAN.md
          RESEARCH.md
          CHECKPOINT.md
  skills/                      # Custom project skills
  observations/                # JSONL observation logs
  metrics.json                 # Cost tracking
  worktrees/                   # Git worktrees (ephemeral)
```

### Team Collaboration: Orphan Branch (`tff-state`)

Since `.tff/` is gitignored, team sync uses a dedicated git orphan branch:

```
main                          ← production code, .tff/ in .gitignore
  milestone/M01               ← code changes only
    slice/M01-S01             ← code changes only

tff-state (orphan)            ← TFF artifacts + state snapshots
  PROJECT.md
  settings.yaml
  state-snapshot.json
  milestones/...
```

### Journal Schema

```typescript
export const JournalEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task-started'), taskId: IdSchema, sliceId: IdSchema, agentIdentity: z.string(), timestamp: TimestampSchema }),
  z.object({ type: z.literal('task-completed'), taskId: IdSchema, sliceId: IdSchema, success: z.boolean(), timestamp: TimestampSchema }),
  z.object({ type: z.literal('task-failed'), taskId: IdSchema, sliceId: IdSchema, error: z.string(), timestamp: TimestampSchema }),
  z.object({ type: z.literal('file-written'), path: z.string(), sliceId: IdSchema, timestamp: TimestampSchema }),
  z.object({ type: z.literal('checkpoint-saved'), sliceId: IdSchema, waveIndex: z.number().int(), timestamp: TimestampSchema }),
  z.object({ type: z.literal('phase-changed'), phase: WorkflowPhaseSchema, sliceId: IdSchema.optional(), timestamp: TimestampSchema }),
  z.object({ type: z.literal('artifact-written'), artifactType: z.enum(['spec', 'plan', 'research', 'checkpoint']), path: z.string(), sliceId: IdSchema, timestamp: TimestampSchema }),
]);
export type JournalEntry = z.infer<typeof JournalEntrySchema>;
```

Journal replay is **idempotent** -- entries describe facts ("task X completed"), not mutations ("set status to Y"). The replay logic derives state from facts, so replaying the same entry twice is a no-op.

### State Schema Versioning

```typescript
// state-snapshot.json includes a version field
export const StateSnapshotSchema = z.object({
  version: z.number().int(),  // bumped when schema changes
  exportedAt: TimestampSchema,
  project: ProjectPropsSchema.optional(),
  milestones: z.array(MilestonePropsSchema),
  slices: z.array(SlicePropsSchema),
  tasks: z.array(TaskPropsSchema),
  workflowSession: WorkflowSessionPropsSchema.optional(),
});
```

Schema evolution strategy: Zod `.default()` handles additive fields. For breaking changes (renames, removals), a migration function per version bump transforms old snapshots. Migrations are registered in a `MIGRATIONS` map keyed by version number.

### Sync Scheduler

The `SyncScheduler` lives in `infrastructure/git/` and owns the debounce timer, dirty flag, and signal handlers:

```typescript
// infrastructure/git/sync-scheduler.ts
export class SyncScheduler {
  constructor(private readonly syncAdapter: StateSyncPort, private readonly journal: JournalPort) {}

  markDirty(): void { /* start/reset 30s debounce timer */ }
  forceSync(): Promise<void> { /* immediate push to tff-state branch */ }
  registerSignalHandlers(): void { /* SIGTERM/SIGINT → best-effort sync */ }
  shutdown(): Promise<void> { /* flush journal + force sync */ }
}
```

The `SyncScheduler` is wired in the CLI entry point and passed to hexagons that need to trigger syncs.

### Two-Tier Sync

**Tier 1: Local Journal (every mutation, instant)**

Append-only JSONL file in `.tff/`. Survives agent crashes. On resume, replay journal to reconstruct in-flight state.

**Tier 2: Orphan Branch Sync (debounced, batched)**

| Event | Journal | Branch Sync |
|-------|---------|-------------|
| Task started | Append | Mark dirty (debounce 30s) |
| File written | Append | Mark dirty |
| Task completed | Append | **Force sync** |
| Phase transition | Append | **Force sync** |
| Every 5 minutes | -- | **Force sync** if dirty |
| Graceful shutdown | Flush | **Force sync** |
| SIGTERM/SIGINT | Best-effort flush | Best-effort sync |

### Crash Recovery

- **Agent crash, `.tff/` intact** -- lose nothing. Journal replays.
- **Agent crash, `.tff/` gone** -- pull from `tff-state` branch. Lose at most the in-flight task. Prior completed tasks recoverable from git branches + last branch sync.
- **No `tff-state` branch** -- fresh project. `/tff:new` starts clean.

### State Reconstruction

```typescript
export class ReconstructStateUseCase {
  async execute(): Promise<Result<ReconstructionReport, never>> {
    // 1. Pull tff-state branch (local or remote)
    // 2. Extract artifacts into .tff/
    // 3. Hydrate SQLite from state-snapshot.json
    // 4. Replay any local journal entries on top
    // If no tff-state: fresh project
  }
}
```

### Conflict Resolution

Different slices: auto-merge (no overlap). Same slice: last-push wins (one person owns a slice at a time).

### Settings Cascade

```
Hardcoded defaults (Zod .default() in schema)
  ← tff-state branch settings.yaml (team-shared)
    ← .tff/settings.yaml (local overrides)
      ← environment variables (TFF_MODEL, TFF_AUTONOMY, etc.)
```

## 8. Model Routing

Unified strategy: role-based profiles with phase overrides and budget awareness.

**Default profiles:**
- `quality` (opus) -- reviewers, security auditor
- `balanced` (sonnet) -- planning, research
- `budget` (haiku/sonnet) -- execution, fixers

**Complexity tier mapping:** S → budget, F-lite → balanced, F-full → quality

**Phase overrides:** Optional per-phase model selection

**Budget enforcement:** Ceiling with progressive downshift (50% → balanced, 75% → budget). Enforcement modes: pause, warn, hard-stop.

**Fallback chains:** Per-profile fallback if primary model unavailable.

## 9. Testing Strategy

- **Framework:** Vitest
- **Colocation:** Tests live next to the files they test (`*.spec.ts`)
- **Builders:** Faker-based builders next to entities (`<name>.builder.ts`)
- **In-Memory Adapters:** Next to their SQLite counterparts in `infrastructure/`
- **Unit Tests:** Domain entities + use cases using builders + in-memory adapters
- **Integration Tests:** SQLite adapters against real SQLite
- **Lint Enforcement:** Biome rules enforcing hexagon import boundaries

## 10. Milestones

### M01a: Kernel + Entity Stack

- Kernel: base classes (Entity, AggregateRoot, ValueObject, DomainEvent), Result, schemas, error base classes, event names
- Project hexagon: entity, schemas, builder, repository port, SQLite + in-memory adapters
- Milestone hexagon: entity, schemas, builder, state, adapters
- Slice hexagon: entity, state machine (SliceStatusVO), complexity tier, builder, adapters
- All domain tests, builder tests, adapter tests for above
- Biome config with hexagon import boundary rules

### M01b: Task + Settings + CLI Bootstrap

- Task hexagon: entity, wave detection (Kahn's algorithm), builder, adapters
- Settings hexagon: schemas with defaults, cascade loading, model routing, YAML validation
- Git port + Git CLI adapter (shared infrastructure)
- CLI bootstrap: two-file loader, PI SDK wiring, extension registration
- Basic commands: `/tff:new`, `/tff:status`
- EventBus: in-process implementation

### M02: Workflow Engine

- Workflow hexagon: WorkflowSession aggregate, state machine, transitions, guards, autonomy modes
- Cross-hexagon event wiring (event bus subscriptions)
- Phase commands: `/tff:discuss`, `/tff:research`, `/tff:plan`
- Artifact management: SPEC.md, PLAN.md, RESEARCH.md generation via agent dispatch (uses PI's `createAgentSession()` for content generation -- a lightweight version of the full execution dispatch that comes in M03)

### M03: Execution & Recovery

- Execution hexagon: wave dispatch, checkpoint entity, agent dispatch via PI sessions
- Worktree management
- Crash recovery: journal, checkpoint replay
- Cost tracking
- `/tff:execute`, `/tff:pause`, `/tff:resume`

### M04: Review & Ship

- Review hexagon: fresh-reviewer enforcement, 3-stage review
- Review UI port: terminal adapter (default), plannotator extension detection
- Ship workflow: PR creation via GitHub port
- `/tff:verify`, `/tff:ship`, `/tff:complete-milestone`

### M05: Intelligence & Auto-Learn

- Intelligence hexagon: observations, patterns, candidates, skills
- Skill enforcer system
- Auto-learn pipeline: extract → rank → create → refine → compose
- `/tff:suggest`, `/tff:skill:new`, `/tff:learn`, `/tff:patterns`, `/tff:compose`

### M06: Team Collaboration & Polish

- Orphan branch sync: two-tier (journal + debounced push), SyncScheduler
- State reconstruction from `tff-state` branch
- Conflict resolution (per-slice granularity)
- GitHub port + gh CLI adapter
- Remaining commands:
  - `/tff:quick` (S-tier shortcut: skip discuss + research)
  - `/tff:debug` (4-phase systematic diagnosis entry)
  - `/tff:health` (cross-hexagon state consistency check)
  - `/tff:progress` (dashboard: milestones, slices, tasks, costs)
  - `/tff:add-slice`, `/tff:remove-slice`, `/tff:insert-slice` (slice management)
  - `/tff:rollback` (revert execution commits for a slice)
  - `/tff:audit-milestone` (milestone completion audit)
  - `/tff:map-codebase` (parallel doc-writer agents)
  - `/tff:sync` (manual bidirectional sync)
  - `/tff:help` (command reference)
- Documentation, README, publishing to npm

## 11. Dependencies

### Runtime
- `zod` -- schema validation
- `zod-to-json-schema` -- Zod → JSON Schema bridge for PI SDK tools
- `@mariozechner/pi-ai` -- LLM abstraction
- `@mariozechner/pi-agent-core` -- Agent runtime
- `@mariozechner/pi-coding-agent` -- CLI coding agent + extension system
- `better-sqlite3` (or Node 22+ built-in `node:sqlite`) -- local state

### Dev
- `typescript` -- type system
- `vitest` -- test framework
- `@faker-js/faker` -- test builders
- `@biomejs/biome` -- linting and formatting
- `tsup` -- bundling

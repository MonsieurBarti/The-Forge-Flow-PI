# Spec — M07-S11: Production Wiring Completeness

## Problem

The composition root (`extension.ts`) uses 7 in-memory/stub adapters ∧ 2 stub wiring patterns that discard production-ready implementations. Consequences:

1. **State loss across sessions** — WorkflowSession, Review, Verification records vanish when conversation ends. Phase commands fail on restart ("No workflow session found").
2. **Dead code** — `JsonlJournalRepository`, `MarkdownCheckpointRepository`, `InMemoryContextStagingAdapter` exist ∧ are functional but ¬wired.
3. **ExecuteSliceUseCase unreachable** — stub rejects w/ "not wired". Real impl (837 lines, 19 deps) exists unused.
4. **Fresh-reviewer bypass** — `CachedExecutorQueryAdapter` returns empty Set → reviewer can review own execution.
5. **TurnMetrics discarded** — collected by `TurnMetricsCollector` in dispatch, included in `AgentResult`, never persisted.
6. **No workflow audit trail** — phase transitions go through ephemeral `InProcessEventBus`, lost on restart.
7. **Context leakage between phases** — phase commands run in same PI session → accumulated context degrades quality. No `ctx.newSession()` enforcement.
8. **StateSnapshot incomplete** — `StateExporter`/`StateImporter` exclude WorkflowSession, Review, Verification → state branch sync loses these entities.

## Approach

**Risk-layered delivery in 3 waves:**

- **Wave 1:** Pure swap — re-wire existing functional adapters (Journal, Checkpoint, ReviewUI). Zero new code.
- **Wave 2:** New/completed adapters — SQLite repos (WorkflowSession, Review, Verification), SettingsModelProfileResolver, DefaultContextStagingAdapter rename, workflow journal.
- **Wave 3:** Complex wiring — ExecuteSliceUseCase full 19-dep graph, executor query, TurnMetrics persistence, StateSnapshot extension, fresh-context enforcement.

## Design

### Wave 1: Pure Swaps

#### 1.1 Journal Repository

`InMemoryJournalRepository` (L176) → `JsonlJournalRepository`.

Constructor: `new JsonlJournalRepository(basePath)` where `basePath` = `${tffDir}/journal`.

#### 1.2 Checkpoint Repository

`InMemoryCheckpointRepository` (L177) → `MarkdownCheckpointRepository`.

Constructor: `new MarkdownCheckpointRepository(basePath, resolveSlicePath)` where:
- `basePath` = `options.projectRoot`
- `resolveSlicePath` = async callback resolving sliceId → worktree path (via `worktreeAdapter`)

#### 1.3 Review UI

`InMemoryReviewUIAdapter` (L283, in `VerifyAcceptanceCriteriaUseCase`) → reuse existing `reviewUI` variable (L166-168, already conditionally wired: plannotator | terminal).

### Wave 2: New/Completed Adapters

#### 2.1 SqliteWorkflowSessionRepository (NEW)

**File:** `src/hexagons/workflow/infrastructure/sqlite-workflow-session.repository.ts`

Port: `WorkflowSessionRepositoryPort` (save, findById, findByMilestoneId).
Add `reset(): void` ∧ `findAll(): Promise<Result<WorkflowSession[], PersistenceError>>` to port interface (required by StateImporter ∧ StateExporter patterns).

Table: `workflow_sessions` in shared `state.db`.

```sql
CREATE TABLE IF NOT EXISTS workflow_sessions (
  id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL,
  slice_id TEXT,
  current_phase TEXT NOT NULL,
  previous_phase TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  autonomy_mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_escalation TEXT  -- JSON-stringified EscalationProps | null
);
```

Pattern: mirror `SqliteSliceRepository` — constructor creates table, `save()` = INSERT OR REPLACE, `findBy*()` = SELECT + `reconstitute()`, `reset()` = DELETE FROM.

Contract test: `workflow-session-repository.contract.spec.ts` using `runContractTests()`.

#### 2.2 SqliteReviewRepository (COMPLETE STUB)

**File:** `src/hexagons/review/infrastructure/repositories/review/sqlite-review.repository.ts`

Port: `ReviewRepositoryPort` (save, findById, findBySliceId, delete).
Add `reset(): void` ∧ `findAll(): Promise<Result<Review[], PersistenceError>>` to port interface.

Table: `reviews` in shared `state.db`.

```sql
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  slice_id TEXT NOT NULL,
  role TEXT NOT NULL,
  agent_identity TEXT NOT NULL,
  verdict TEXT NOT NULL,
  findings TEXT NOT NULL,  -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`findings` stored as JSON column (array of `ReviewFinding` objects). Parsed w/ `JSON.parse()` on read, `JSON.stringify()` on write.

Contract test: `review-repository.contract.spec.ts`.

#### 2.3 SqliteVerificationRepository (COMPLETE STUB)

**File:** `src/hexagons/review/infrastructure/repositories/verification/sqlite-verification.repository.ts`

Port: `VerificationRepositoryPort` (save, findBySliceId).
Add `reset(): void` ∧ `findAll(): Promise<Result<Verification[], PersistenceError>>` to port interface.

Table: `verifications` in shared `state.db`.

```sql
CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  slice_id TEXT NOT NULL,
  agent_identity TEXT NOT NULL,
  criteria TEXT NOT NULL,       -- JSON array
  overall_verdict TEXT NOT NULL,
  fix_cycle_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

`criteria` stored as JSON column. Contract test: `verification-repository.contract.spec.ts`.

#### 2.4 SettingsModelProfileResolver (NEW)

**File:** `src/hexagons/workflow/infrastructure/settings-model-profile-resolver.ts`

Implements `ModelProfileResolverPort.resolveForPhase(phase, complexity)`.

Logic: load merged settings → `phaseOverrides[phase] ?? complexityMapping[complexity]`.

```typescript
export class SettingsModelProfileResolver extends ModelProfileResolverPort {
  constructor(private readonly mergeSettings: MergeSettingsUseCase) {}

  async resolveForPhase(phase: WorkflowPhase, complexity: ComplexityTier): Promise<ModelProfileName> {
    const result = this.mergeSettings.execute({ team: null, local: null, env: {} });
    if (!result.ok) return "balanced"; // safe default
    const routing = result.data.modelRouting;
    return routing.phaseOverrides?.[phase] ?? routing.complexityMapping[complexity];
  }
}
```

#### 2.5 Rename InMemoryContextStagingAdapter → DefaultContextStagingAdapter

**File rename:** `in-memory-context-staging.adapter.ts` → `default-context-staging.adapter.ts`
**Spec rename:** `in-memory-context-staging.adapter.spec.ts` → `default-context-staging.adapter.spec.ts`
**Class rename:** `InMemoryContextStagingAdapter` → `DefaultContextStagingAdapter`
**Barrel update:** `src/hexagons/workflow/index.ts`

Wire in extension.ts: `new DefaultContextStagingAdapter({ modelProfileResolver: settingsModelProfileResolver })`

Replaces `NoOpContextStaging` (L103-107, L445). Delete `NoOpContextStaging` class from extension.ts.

#### 2.6 WorkflowJournalPort + JsonlWorkflowJournalRepository (NEW)

**Port:** `src/hexagons/workflow/domain/ports/workflow-journal.port.ts`

```typescript
export const WorkflowJournalEntrySchema = z.object({
  type: z.enum(["session-created", "phase-transition", "escalation"]),
  sessionId: z.string(),
  milestoneId: z.string(),
  sliceId: z.string().optional(),
  fromPhase: z.string().optional(),
  toPhase: z.string().optional(),
  trigger: z.string().optional(),
  timestamp: TimestampSchema,
  metadata: z.record(z.unknown()).optional(),
});

export type WorkflowJournalEntry = z.infer<typeof WorkflowJournalEntrySchema>;

export abstract class WorkflowJournalPort {
  abstract append(entry: WorkflowJournalEntry): Promise<Result<void, PersistenceError>>;
  abstract readAll(): Promise<Result<WorkflowJournalEntry[], PersistenceError>>;
}
```

**Adapter:** `src/hexagons/workflow/infrastructure/jsonl-workflow-journal.repository.ts`

Mirror `JsonlJournalRepository` pattern: append-only JSONL, one entry per line, atomic write via temp file.

Constructor: `new JsonlWorkflowJournalRepository(filePath)` where `filePath` = `${tffDir}/workflow-journal.jsonl`.

#### 2.7 ReplayWorkflowJournalUseCase (NEW)

**File:** `src/hexagons/workflow/application/replay-workflow-journal.use-case.ts`

Reconstruct `WorkflowSession` from journal entries when SQLite data is missing:

```typescript
export class ReplayWorkflowJournalUseCase {
  constructor(
    private readonly journal: WorkflowJournalPort,
    private readonly sessionRepo: WorkflowSessionRepositoryPort,
  ) {}

  async execute(): Promise<Result<number, PersistenceError>> {
    const entries = await this.journal.readAll();
    if (!entries.ok) return entries;
    // Group by sessionId, replay phase transitions, save to repo
    // Returns count of sessions reconstructed
  }
}
```

### Wave 3: Complex Wiring

#### 3.1 ExecuteSliceUseCase Full Wiring

Replace stub (L184-186) w/ real `ExecuteSliceUseCase` instantiation in extension.ts.

19 dependencies to wire:

| Dep | Source |
|-----|--------|
| `taskRepository` | `taskRepo` (existing, L155) |
| `waveDetection` | `new DetectWavesUseCase()` (existing, L441) |
| `checkpointRepository` | `MarkdownCheckpointRepository` (from Wave 1.2) |
| `agentDispatch` | `sharedAgentDispatch` (existing, L119) |
| `worktree` | `worktreeAdapter` (existing, L140) |
| `eventBus` | `eventBus` (existing, L116) |
| `journalRepository` | `JsonlJournalRepository` (from Wave 1.1) |
| `metricsRepository` | `new JsonlMetricsRepository(metricsPath)` — NEW instantiation |
| `dateProvider` | `dateProvider` (existing, L117) |
| `logger` | `logger` (existing, L115) |
| `templateContent` | `readFileSync(join(projectRoot, "src/resources/protocols/execute.md"), "utf-8")` |
| `guardrail` | `new ComposableGuardrailAdapter(rules, overrides, gitPort)` — wire w/ default rules |
| `gitPort` | `gitPort` (existing, L135) |
| `overseer` | `new ComposableOverseerAdapter(strategies)` — wire w/ default strategies |
| `retryPolicy` | `new DefaultRetryPolicy(config)` — config from merged settings |
| `overseerConfig` | Defaults from `OverseerConfigSchema.parse({})` |
| `preDispatchGuardrail` | `new ComposablePreDispatchAdapter(rules)` — wire w/ default rules |
| `modelResolver` | `modelResolver` (existing, L210-213) |
| `checkpointBeforeRetry` | `true` (default) |

#### 3.2 CachedExecutorQueryAdapter Real Query

Replace stub (L201-204):

```typescript
const getSliceExecutors = new GetSliceExecutorsUseCase(checkpointRepo);
const executorQueryAdapter = new CachedExecutorQueryAdapter(
  async (sliceId) => getSliceExecutors.execute(sliceId),
);
```

Uses same `MarkdownCheckpointRepository` instance from Wave 1.2. Queries checkpoint's `executorLog` for agent identities.

#### 3.3 TurnMetrics Persistence

TurnMetrics are already collected in `PiAgentDispatchAdapter` (L342) ∧ returned in `AgentResult.turns`. Persistence happens at the `ExecuteSliceUseCase` level — after dispatch returns `AgentResult`, the use case writes task metrics via `RecordTaskMetricsUseCase` / `MetricsRepositoryPort`.

**Changes:**
1. Extend `TaskMetricsSchema` w/ `turns: z.array(TurnMetricsSchema).optional().default([])`.
2. In `ExecuteSliceUseCase`, after dispatch completes ∧ `AgentResult` is available, include `result.turns` in the task metrics entry passed to `metricsRepository.append()`.

¬changes to `PiAgentDispatchAdapter` or its deps — persistence stays at the use-case layer where `MetricsRepositoryPort` is already injected.

#### 3.4 StateSnapshot Extension

**File:** `src/kernel/infrastructure/state-branch/state-snapshot.schemas.ts`

Add 3 new fields w/ `.default([])` for backward compat:

```typescript
export const SCHEMA_VERSION = 2; // was 1

export const StateSnapshotSchema = z.object({
  version: z.number().int().positive(),
  exportedAt: TimestampSchema,
  project: ProjectPropsSchema.nullable(),
  milestones: z.array(MilestonePropsSchema),
  slices: z.array(SlicePropsSchema),
  tasks: z.array(TaskPropsSchema),
  shipRecords: z.array(ShipRecordPropsSchema).default([]),
  completionRecords: z.array(CompletionRecordPropsSchema).default([]),
  // v2 additions:
  workflowSessions: z.array(WorkflowSessionPropsSchema).default([]),
  reviews: z.array(ReviewPropsSchema).default([]),
  verifications: z.array(VerificationPropsSchema).default([]),
});
```

Migration: `MIGRATIONS` map entry `1 → 2`: identity (`.default([])` handles missing fields).

#### 3.5 StateExporter / StateImporter Extension

**StateExporter deps:** add `workflowSessionRepo`, `reviewRepo`, `verificationRepo`.
**StateExporter.export():** query ∧ serialize all 3 new entity types.

**StateImporter deps:** same 3 new repos.
**StateImporter.import():** reset ∧ reconstitute all 3 new entity types (after tasks, before ship records).

#### 3.6 Port Interface Changes

Add to all 3 ports:
- `abstract reset(): void` — required by StateImporter
- `abstract findAll(): Promise<Result<T[], PersistenceError>>` — required by StateExporter (mirrors `ShipRecordRepositoryPort.findAll()` pattern)

Ports affected:
- `WorkflowSessionRepositoryPort` (`src/hexagons/workflow/domain/ports/workflow-session.repository.port.ts`)
- `ReviewRepositoryPort` (`src/hexagons/review/domain/ports/review-repository.port.ts`)
- `VerificationRepositoryPort` (`src/hexagons/review/domain/ports/verification-repository.port.ts`)

In-memory implementations already have `reset()` — add `findAll()` to both in-memory ∧ SQLite implementations.

#### 3.7 OrchestratePhaseTransitionUseCase Write-Through

Inject `WorkflowJournalPort` into `OrchestratePhaseTransitionUseCase`.

On every phase transition: append journal entry alongside SQLite session update.

```typescript
await this.workflowJournal.append({
  type: "phase-transition",
  sessionId: session.id,
  milestoneId: session.milestoneId,
  sliceId: session.sliceId,
  fromPhase: session.previousPhase,
  toPhase: session.currentPhase,
  trigger,
  timestamp: this.dateProvider.now().toISOString(),
});
```

#### 3.8 Fresh Context Per Phase (GSD-2 Pattern)

All phase commands (discuss, research, plan, execute, ship) enforce fresh PI session.

**Change:** Add `ctx: ExtensionCommandContext` as 2nd parameter to command handler signatures (PI SDK provides it but current handlers don't accept it):

```typescript
// Before: handler: async (args: string) => { ... }
// After:
handler: async (args: string, ctx: ExtensionCommandContext) => {
  await ctx.newSession(); // fresh 200K context window
  // ... load all context from DB + artifacts ...
  // ... send pre-loaded protocol message ...
}
```

**Note:** `ExtensionCommandContext.newSession()` is verified in the PI SDK (`@mariozechner/pi-coding-agent` ≥ 0.64.0) and used by GSD-2 in `auto-direct-dispatch.ts`. If the API shape differs from expected at implementation time, fallback: use `api.sendMessage(protocol, { triggerTurn: true, deliverAs: "nextTurn" })` after a session-level context reset.

**Supervised mode:** user runs `/tff:research M07-S11` → `newSession()` → load SPEC.md + session from SQLite → send protocol.

**Plan-to-pr mode:** `OrchestratePhaseTransitionUseCase` chains `newSession()` + auto-dispatches next phase command. Each phase starts with clean context, all data injected from persistence.

**Files affected:**
- `src/hexagons/workflow/infrastructure/pi/discuss.command.ts` (L20)
- `src/hexagons/workflow/infrastructure/pi/research.command.ts` (L23)
- `src/hexagons/workflow/infrastructure/pi/plan.command.ts` (L22)
- Execute ∧ ship phases are triggered through `ExecuteSliceUseCase` ∧ `ShipSliceUseCase` respectively — ¬command files. Fresh context for these is enforced by the workflow orchestrator calling `newSession()` before dispatching execution/ship.

## Acceptance Criteria

- **AC1:** Zero `InMemory*` adapters in extension.ts (except `InMemoryAgentEventHub` — intentional in-process pub/sub)
- **AC2:** Zero `NoOp*` adapters in extension.ts
- **AC3:** Zero `AlwaysUnder*` stubs (except `AlwaysUnderBudgetAdapter` — deferred to cost tracking milestone)
- **AC4:** Workflow session survives restart — start discuss in one PI session, run `/tff:research` in fresh session, session found in SQLite
- **AC5:** Review ∧ verification records persist via SQLite — save → restart → findBySliceId returns saved data
- **AC6:** Execution journal ∧ checkpoints persist to filesystem — JSONL ∧ Markdown files written under `.tff/`
- **AC7:** `ExecuteSliceUseCase` fully wired — real use case w/ all 19 deps, no stub
- **AC8:** Fresh reviewer enforcement works — `CachedExecutorQueryAdapter` queries real checkpoint, `FreshReviewerService` rejects executor-as-reviewer
- **AC9:** TurnMetrics persisted in `metrics.jsonl` — entries include per-turn tool counts ∧ timing
- **AC10:** StateSnapshot round-trip complete — v2 schema w/ workflowSessions, reviews, verifications + migration from v1
- **AC11:** Workflow journal captures transitions — append-only JSONL records phase transitions; `ReplayWorkflowJournalUseCase` reconstructs session from journal
- **AC12:** Contract tests pass for `SqliteWorkflowSessionRepository`, `SqliteReviewRepository`, `SqliteVerificationRepository` using `runContractTests()` pattern
- **AC13:** Fresh context enforced per phase — `ctx.newSession()` called before protocol in all phase commands. Plan-to-pr auto-chains w/ fresh sessions
- **AC14:** `DefaultContextStagingAdapter` wired w/ `SettingsModelProfileResolver` — `InMemoryContextStagingAdapter` renamed, `NoOpContextStaging` deleted
- **AC15:** All existing tests pass — zero regressions

## Non-Goals

- ¬`AlwaysUnderBudgetAdapter` replacement (deferred to cost tracking milestone)
- ¬`InMemoryAgentEventHub` replacement (intentional in-process pub/sub)
- ¬new domain events for adapter swaps (mechanical wiring only)
- ¬migration of existing in-memory test fixtures to SQLite (tests keep in-memory adapters)
- ¬guardrail rule definitions beyond defaults (full customization in S10/G09)
- ¬overseer strategy tuning (defaults only)

## Complexity Signals

- `estimatedFilesAffected`: ~30 (extension.ts, 3 SQLite repos, 3 port interfaces, 2 new adapters, state snapshot, exporter, importer, 6+ command files, rename, contract tests)
- `newFilesCreated`: ~8 (SqliteWorkflowSessionRepository, SettingsModelProfileResolver, JsonlWorkflowJournalRepository, ReplayWorkflowJournalUseCase, 3 contract tests, DefaultContextStagingAdapter rename)
- `modulesAffected`: 5 (workflow, review, execution, kernel, cli)
- `requiresInvestigation`: false (all patterns established in prior slices)
- `architectureImpact`: true (fresh-context enforcement changes phase command behavior; StateSnapshot v2)
- `hasExternalIntegrations`: false
- `taskCount`: ~12-15
- `unknownsSurfaced`: 0

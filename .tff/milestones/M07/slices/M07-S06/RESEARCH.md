# Research — M07-S06: Execution Pipeline Improvements (G-pre → A → B)

## 1. Existing Execution Flow (Exact)

### ExecuteSliceUseCase Dependencies (16 total)

```
taskRepository, waveDetection, checkpointRepository, agentDispatch,
worktree, eventBus, journalRepository, metricsRepository,
dateProvider, logger, templateContent, guardrail (OutputGuardrailPort),
gitPort, overseer, retryPolicy, overseerConfig
```

New dependency needed: `preDispatchGuardrail: PreDispatchGuardrailPort`

### Wave Execution — Current Control Flow

```
FOR EACH WAVE (sequential):
  1. Skip if checkpoint.isWaveCompleted(waveIndex)
  2. Filter tasks: exclude completed + stale claims (>30min)
  3. task.start() + checkpoint.recordTaskStart()
  4. Build AgentDispatchConfig via PromptBuilder
  5. Promise.allSettled(waveTasks.map(executeTaskWithOverseer))
  6. Wave-level guardrail validation (per settled task)
     → blocker? restoreWorktree() + aborted=true + break
     → warning? enrich AgentResult.concerns
  7. Process settled results → completedTasks / failedTasks
     → ANY failure? aborted=true + break    ← MUST CHANGE
  8. checkpoint.advanceWave() + save
  9. Check abort signal between waves
```

### executeTaskWithOverseer — Current Retry Loop

```
if overseer disabled → direct dispatch, return
maxRetries = min(2, overseerConfig.retryLoop.threshold)

for attempt = 0..maxRetries:
  monitorPromise = overseer.monitor(context)
  dispatchPromise = agentDispatch.dispatch(config)
  race(dispatch, monitor)
    → dispatch wins: stop overseer, return AgentResult
    → monitor wins: abort dispatch
       recordFailure(taskId, verdict.strategy)
       shouldRetry(taskId, strategy, attempt)
       → no retry: journal "escalated", return OverseerError
       → retry: journal "retrying", enrich prompt, restoreWorktree()

return OverseerError("max retries exhausted")
```

**Key: overseer retry is mid-dispatch intervention only.** The new downshift chain operates post-wave, wrapping around this loop.

## 2. Integration Points — Per Feature

### G-pre: Pre-Dispatch Guardrails

**Existing guardrail pattern (`GuardrailRule`):**
- Interface: `{ id: GuardrailRuleId; evaluate(ctx: EnrichedGuardrailContext): GuardrailViolation[] }` — **sync**
- `GuardrailRuleId` is a Zod enum: `["dangerous-commands", "credential-exposure", "destructive-git", "file-scope", "suspicious-content"]`
- `EnrichedGuardrailContext` extends `GuardrailContext` with `fileContents: Map<string, string>` + `gitDiff: string`
- ComposableGuardrailAdapter: enriches context → runs all rules → collects violations → severity overrides → report

**New pre-dispatch pattern (different interface):**
- `PreDispatchGuardrailRule` is a **separate interface** from `GuardrailRule` (async, different context, different violation schema)
- Pre-dispatch rules don't need file content enrichment — they validate metadata (paths, branch, budget, deps, tools)
- Exception: `worktree-state` rule needs `GitPort` for `git status` / `git rev-parse` — hence async
- New rule IDs are plain strings, not part of existing `GuardrailRuleIdSchema` enum

**Where to insert in flow:** Before step 5 (Promise.allSettled). Pre-dispatch is per-task, parallel-safe (no side effects). Can run inside the `waveTasks.map()` before dispatch.

**`sliceFilePaths` computation:** Union of `task.filePaths` for all tasks in the slice. Computed once at `execute()` start.

### A: Per-Task Reflection

**Self-review data available in AgentResult:**
```
agentResult.selfReview.dimensions: [
  { dimension: "completeness", passed: boolean, note?: string },
  { dimension: "quality", passed: boolean, note?: string },
  { dimension: "discipline", passed: boolean, note?: string },
  { dimension: "verification", passed: boolean, note?: string },
]
agentResult.selfReview.overallConfidence: "high" | "medium" | "low"
agentResult.concerns: AgentConcern[]  // area, description, severity
agentResult.status: "DONE" | "DONE_WITH_CONCERNS" | "BLOCKED" | "NEEDS_CONTEXT"
```

**Fast-path trigger logic:**
- All 4 dimensions `passed === true` AND `concerns.length === 0` AND `status === "DONE"` → pass (no full review)
- Any dimension `passed === false` OR `concerns.length > 0` OR `status !== "DONE"` → trigger full path

**Full-path implementation:**
- Fresh `agentDispatch.dispatch(reflectionConfig)` — new session
- `reflectionConfig.tools`: read-only subset `["Read", "Glob", "Grep", "Bash"]`
- `reflectionConfig.taskPrompt`: task ACs + `git diff <baseCommit>..HEAD` output
- `baseCommit` from `Checkpoint.baseCommit` — immutable, set at checkpoint creation
- Parse `ReflectionResult` from agent output (same TFF_STATUS_REPORT marker pattern? Or new marker?)

**Decision: reflection output format.** Two options:
1. Reuse `TFF_STATUS_REPORT` markers — agent returns standard status report, interpret as reflection
2. New `TFF_REFLECTION_REPORT` markers — dedicated schema, cleaner separation

**Recommendation:** New markers. Reflection has different semantics (issues[] with severity, not dimensions). Avoids confusion in agent prompt.

**Where to insert in flow:** After step 5 (Promise.allSettled settles), before step 6 (guardrail). Reflection runs per completed task, **sequentially** (after wave settles). This is safe because all dispatches are done.

### B: Model Downshift Fallback

**Current RetryPolicy:**
```typescript
abstract class RetryPolicy {
  abstract shouldRetry(taskId, errorCode, attempt): RetryDecision;
  abstract recordFailure(taskId, errorSignature): void;
  abstract reset(taskId): void;
}
```

DefaultRetryPolicy: in-memory Map of signatures, max retries, loop detection (N identical errors).

**Adding `resolveModel()`:**
- New abstract method alongside existing three
- DefaultRetryPolicy implementation: track `currentProfileIndex` per task, walk `downshiftChain`
- Returns `ModelResolution { action, profile, attempt }`

**Model resolution chain (two levels):**

```
RetryPolicy.resolveModel(taskId, currentProfile, attempt)
  → returns profile name (e.g., "balanced")

ResolveModelUseCase.execute({ profile: "balanced", complexity, ... })
  → applies per-profile fallbackChain (model unavailability)
  → returns ModelName (string, e.g., "sonnet")

??? → map ModelName to ResolvedModel { provider, modelId }
```

**FINDING: Gap in model resolution.**
- `ExecuteSliceInput.model` is `ResolvedModel { provider, modelId }` — already resolved upstream
- `ResolveModelUseCase` returns `ModelName` (string), not `ResolvedModel`
- There's a missing step: `ModelName` → `ResolvedModel`. Currently done outside ExecuteSliceUseCase
- For downshift, ExecuteSliceUseCase must resolve models internally
- **Need:** Either (a) inject `ResolveModelUseCase` as dependency, or (b) inject a simpler `ModelResolverPort` that maps `profileName → ResolvedModel`
- Looking at PiAgentDispatchAdapter: it has `resolveModel: (provider, modelId) => Model<Api>` — this converts ResolvedModel to SDK Model, but doesn't help with profile → model mapping

**Resolution:** Add `modelRouting: ModelRoutingConfig` to ExecuteSliceInput (it's already available at the call site). Then `DefaultRetryPolicy` or the use case can look up `routing.profiles[profileName].model` and construct `ResolvedModel`. Provider can be defaulted (it's always "anthropic" currently) or extracted from settings.

**Where to insert in flow:** Post-wave, after collecting failures. Sequential retry pass operates outside the wave loop. Each failed task: resolveModel → checkpoint → restore worktree → re-dispatch.

## 3. Schema Changes Required

### journal-entry.schemas.ts — 4 New Entry Types

Must add to discriminated union array. Pattern:

```typescript
// 1. Define schema
const ReflectionEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("reflection"),
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  tier: z.enum(["fast", "full"]),
  passed: z.boolean(),
  issues: z.array(ReflectionIssueSchema).default([]),
  triggeredRetry: z.boolean(),
});

// 2. Add to union
export const JournalEntrySchema = z.discriminatedUnion("type", [
  ...existing 12...,
  ReflectionEntrySchema,
  ModelDownshiftEntrySchema,
  TaskEscalatedEntrySchema,
  PreDispatchBlockedEntrySchema,
]);
```

ReplayJournalUseCase only uses `task-completed` and `checkpoint-saved` for replay validation. New types pass through without affecting replay logic — but AC9 requires they're accepted by the schema.

### task-metrics.schemas.ts — 3 New Fields

```typescript
// Add to TaskMetricsSchema:
reflectionTier: z.enum(["fast", "full", "skipped"]).default("skipped"),
finalProfile: z.string().optional(),
totalAttempts: z.number().int().nonnegative().optional(),
```

Existing `reflectionPassed` stays optional. Existing `downshifted` stays boolean with default false.

### project-settings.schemas.ts — Fallback Strategy

Follow the Base + .catch(defaults) pattern:

```typescript
const BaseFallbackStrategySchema = z.object({
  retryCount: z.number().int().min(0).max(3).default(1),
  downshiftChain: z.array(ModelProfileNameSchema).default(["quality", "balanced", "budget"]),
  checkpointBeforeRetry: z.boolean().default(true),
});

export const FALLBACK_STRATEGY_DEFAULTS = {
  retryCount: 1,
  downshiftChain: ["quality", "balanced", "budget"],
  checkpointBeforeRetry: true,
};

export const FallbackStrategySchema = BaseFallbackStrategySchema.catch(FALLBACK_STRATEGY_DEFAULTS);
```

Add to `ProjectSettingsSchema` as `fallback: FallbackStrategySchema.optional()`.

## 4. Behavioral Changes (Risk Assessment)

### Wave-Level Abort → Per-Task Failure Collection

**Current (lines 473-478):**
```typescript
if (waveFailedTasks.length > 0) {
  failedTasks.push(...waveFailedTasks);
  aborted = true;
  break;
}
```

**New:** Remove `aborted = true; break`. Collect failures into `retryableTasks[]`. After wave settles: run retry pass. Only `escalated` tasks are permanently failed.

**Risk:** This changes the fail-fast contract. Currently, first failure stops everything. New behavior: execution continues with remaining tasks even if one fails. This is intentional (spec AC10/AC11) but consumers of `ExecuteSliceResult.aborted` may need updating.

**Mitigation:** `aborted` flag now only true for abort signal or total escalation (all retry chain exhausted). Partial failures are tracked in `failedTasks[]`.

### Guardrail Blocker → Task-Level (Not Wave-Level)

**Current:** `restoreWorktree()` on any guardrail blocker → all wave work lost.

**New:** Guardrail blocker marks individual task as failed → enters retry pass. Other tasks' work preserved. `restoreWorktree()` only called per-task during sequential retry pass.

**Risk:** If a guardrail-blocked task's changes pollute other tasks' assumptions, the remaining tasks may produce incorrect results. However, this matches real-world behavior — tasks within a wave are independent by construction (no dependency edges).

## 5. File Inventory

### New Files (12)

| File | Purpose |
|---|---|
| `execution/domain/ports/pre-dispatch-guardrail.port.ts` | Abstract port |
| `execution/domain/pre-dispatch.schemas.ts` | Context, report, violation, rule interface schemas |
| `execution/domain/reflection.schemas.ts` | ReflectionResult, ReflectionIssue schemas |
| `execution/domain/fallback.schemas.ts` | FallbackStrategy, ModelResolution schemas |
| `execution/infrastructure/guardrails/pre-dispatch/scope-containment.rule.ts` | Rule: taskFilePaths ⊆ sliceFilePaths |
| `execution/infrastructure/guardrails/pre-dispatch/worktree-state.rule.ts` | Rule: correct branch + clean (async, needs GitPort) |
| `execution/infrastructure/guardrails/pre-dispatch/budget-check.rule.ts` | Rule: budgetRemaining ≥ estimated |
| `execution/infrastructure/guardrails/pre-dispatch/dependency-check.rule.ts` | Rule: upstream tasks completed |
| `execution/infrastructure/guardrails/pre-dispatch/tool-policy.rule.ts` | Rule: tools ⊆ allowed (placeholder) |
| `execution/infrastructure/adapters/pre-dispatch/composable-pre-dispatch.adapter.ts` | Composes rules, returns report |
| `execution/infrastructure/adapters/pre-dispatch/in-memory-pre-dispatch.adapter.ts` | Test double |
| `execution/application/build-reflection-config.ts` | Builds reflection AgentDispatchConfig from task + diff |

### Modified Files (8)

| File | Change |
|---|---|
| `execution/domain/ports/retry-policy.port.ts` | Add `resolveModel()` abstract method |
| `execution/domain/task-metrics.schemas.ts` | Add reflectionTier, finalProfile, totalAttempts |
| `execution/domain/journal-entry.schemas.ts` | Add 4 entry types to discriminated union |
| `execution/application/execute-slice.use-case.ts` | Major rewrite: pre-dispatch → reflection → retry pass |
| `execution/infrastructure/policies/default-retry-policy.ts` | Implement resolveModel() with downshift chain tracking |
| `execution/infrastructure/pi/execution.extension.ts` | Register PreDispatchGuardrailPort |
| `settings/domain/project-settings.schemas.ts` | Add FallbackStrategy to ProjectSettingsSchema |
| `execution/index.ts` | Barrel exports for new ports, adapters, schemas |

## 6. Dependency Graph (Implementation Order)

```
Wave 1 (foundation — no cross-dependencies):
  ├─ pre-dispatch.schemas.ts
  ├─ reflection.schemas.ts
  ├─ fallback.schemas.ts
  ├─ pre-dispatch-guardrail.port.ts
  └─ journal-entry.schemas.ts (4 new types)

Wave 2 (rules — depend on schemas):
  ├─ scope-containment.rule.ts
  ├─ worktree-state.rule.ts
  ├─ budget-check.rule.ts
  ├─ dependency-check.rule.ts
  ├─ tool-policy.rule.ts
  └─ composable-pre-dispatch.adapter.ts + in-memory

Wave 3 (policy + settings — depend on schemas):
  ├─ retry-policy.port.ts (add resolveModel)
  ├─ default-retry-policy.ts (implement resolveModel)
  ├─ task-metrics.schemas.ts (add fields)
  └─ project-settings.schemas.ts (add fallback)

Wave 4 (integration — depends on all above):
  ├─ build-reflection-config.ts
  ├─ execute-slice.use-case.ts (major rewrite)
  └─ execution.extension.ts (wiring)

Wave 5 (exports):
  └─ execution/index.ts (barrel)
```

## 7. Open Questions (Resolved)

| Question | Resolution |
|---|---|
| How does reflection output get parsed? | New `TFF_REFLECTION_REPORT` markers, dedicated schema |
| How to get ResolvedModel during downshift? | Pass `ModelRoutingConfig` via ExecuteSliceInput; look up `profiles[profileName].model`; construct ResolvedModel with default provider |
| Does replay need updating for new journal types? | No — replay only uses task-completed + checkpoint-saved |
| Where does worktree-state rule get GitPort? | Injected at rule construction time, passed through ComposablePreDispatchAdapter |
| What happens on reflection parse failure? | Treat as warning, proceed (spec constraint) |

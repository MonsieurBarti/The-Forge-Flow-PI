# Spec — M07-S06: Execution Pipeline Improvements (G-pre → A → B)

## Problem

The execution pipeline dispatches tasks without pre-validation, has no structured self-review mechanism, and lacks automated recovery from agent failures beyond simple retry. Specifically:

1. **No pre-dispatch checks** — out-of-scope tasks, dirty worktrees, missing dependencies, and disallowed tools are caught only after dispatch (or not at all).
2. **No structured reflection** — agents self-report via a checklist, but blockers aren't caught until post-dispatch guardrails. No git-diff-based review.
3. **No model fallback** — if an agent fails, the same model retries or the task escalates. No downshift to a cheaper/different model.

## Approach

New ports + extend existing use case (Approach A). Three features delivered sequentially: G-pre → A → B.

- **PreDispatchGuardrailPort** — new port with 5 async rules, injected into `ExecuteSliceUseCase`
- **Reflection** — layered step in `executeTaskWithOverseer()` using fresh dispatch for full-path review
- **Model downshift** — `RetryPolicy` extended with `resolveModel()`, settings-driven cross-profile chain

## Design

### G-pre: Pre-Dispatch Guardrails

#### PreDispatchGuardrailPort

```typescript
abstract class PreDispatchGuardrailPort {
  abstract validate(context: PreDispatchContext): Promise<Result<PreDispatchReport, GuardrailError>>;
}
```

#### PreDispatchContext

```typescript
PreDispatchContextSchema = z.object({
  taskId: z.string(),
  sliceId: z.string(),
  milestoneId: z.string(),
  taskFilePaths: z.array(z.string()),
  sliceFilePaths: z.array(z.string()),
  worktreePath: z.string().optional(),
  expectedBranch: z.string(),
  agentModel: z.string(),
  agentTools: z.array(z.string()),
  upstreamTasks: z.array(z.object({       // full task info, not just IDs
    id: z.string(),
    status: z.string(),
  })),
  budgetRemaining: z.number().optional(),
  budgetEstimated: z.number().optional(),
});
```

#### PreDispatchReport + Violation

```typescript
PreDispatchReportSchema = z.object({
  passed: z.boolean(),
  violations: z.array(PreDispatchViolationSchema),
  checkedAt: z.string().datetime(),
});

PreDispatchViolationSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(["blocker", "warning"]),
  message: z.string(),
  metadata: z.record(z.unknown()).optional(),
});
```

#### Rules

| Rule | ID | Severity | Logic |
|---|---|---|---|
| Scope containment | `scope-containment` | blocker | `taskFilePaths ⊆ sliceFilePaths` |
| Worktree state | `worktree-state` | blocker | Branch matches `expectedBranch`, no uncommitted changes |
| Budget check | `budget-check` | warning | `budgetRemaining ≥ budgetEstimated` |
| Dependency check | `dependency-check` | blocker | ∀ upstream task in `upstreamTasks`: status = completed |
| Tool policy | `tool-policy` | blocker | `agentTools ⊆ allowed tools for agent role` |

#### PreDispatchGuardrailRule interface

```typescript
interface PreDispatchGuardrailRule {
  readonly id: string;
  evaluate(context: PreDispatchContext): Promise<PreDispatchViolation[]>;  // async — worktree-state needs git
}
```

Note: `evaluate()` is async because `worktree-state` must run `git status` / `git branch` via `GitPort`. Rules that don't need I/O return resolved promises.

#### ComposablePreDispatchAdapter

- Iterates rules, collects violations (all rules run, not short-circuit)
- `passed` = zero blocker violations
- Journals `pre-dispatch-blocked` on any violation
- Constructor receives `PreDispatchGuardrailRule[]` + `GitPort` (injected into worktree-state rule)

#### Integration

- Called in `executeTaskWithOverseer()` BEFORE dispatch
- Blocker → task skipped, marked failed. Remaining wave tasks still execute (task-level, not wave-level abort).
- Warning → logged to journal, dispatch proceeds

---

### A: Per-Task Reflection

#### Fresh Session for Reflection

Reflection uses a **new `dispatch()` call** with a reflection-specific agent config. No changes to `AgentDispatchPort` — the existing single-turn `dispatch()` + `session.dispose()` model is preserved. Each phase (dispatch, reflection, guardrail) runs with completely fresh context.

The reflection dispatch config:
- `taskId`: `{originalTaskId}-reflection` (distinct ID for journaling)
- `agentType`: same as original task agent
- `systemPrompt`: reflection-specific prompt (review focus, not implementation)
- `taskPrompt`: includes task ACs + `git diff &lt;baseCommit&gt;..HEAD` output + original task description
- `model`: same model as the original dispatch (or downshifted model on retry)
- `tools`: read-only subset (`Read`, `Glob`, `Grep`, `Bash` for git diff)

#### ReflectionResult

```typescript
ReflectionResultSchema = z.object({
  passed: z.boolean(),
  tier: z.enum(["fast", "full"]),
  issues: z.array(ReflectionIssueSchema),
  reflectedAt: z.string().datetime(),
});

ReflectionIssueSchema = z.object({
  severity: z.enum(["blocker", "warning"]),
  description: z.string(),
  filePath: z.string().optional(),
});
```

#### Layered Flow

1. **Fast path** (always runs):
   - Parse agent's `selfReview` from `AgentResult` (existing in `PiAgentDispatchAdapter`)
   - All dimensions pass + no concerns → `ReflectionResult { passed: true, tier: 'fast' }`
   - Any concern or dimension fail → escalate to full path

2. **Full path** (triggered by fast-path concern OR F-full tier):
   - Fresh `agentDispatch.dispatch(reflectionConfig)` — new session, read-only tools
   - `reflectionConfig.taskPrompt` includes task ACs + `git diff &lt;baseCommit&gt;..HEAD` output from worktree
   - Parse structured response → `ReflectionResult`
   - BLOCKER → enter retry/downshift chain (B). Journal `reflection` with `triggeredRetry: true`.
   - WARNING → record in journal, proceed
   - PASS → proceed to post-dispatch guardrail

#### Tier-Based Reflection Rules

| Task Tier | Self-Review Clean | Behavior |
|---|---|---|
| S | Any | Fast path only — never full review |
| F-lite | Clean | Fast path — skip full review |
| F-lite | Concern flagged | Full path — git diff review |
| F-full | Any | Always full path — git diff review |

#### Constraints

- Max 1 reflection per task dispatch (no reflection loops)
- Reflection blockers count as task failures → enter retry/downshift chain
- Reflection dispatch uses read-only tools — cannot modify code, only review

#### TaskMetrics update

- `reflectionPassed: boolean | undefined` (stays optional — `undefined` when skipped)
- `reflectionTier: 'fast' | 'full' | 'skipped'` (new field, optional, default `'skipped'`)

---

### B: Model Downshift Fallback

#### Relationship to Existing FallbackChain

Two distinct fallback mechanisms exist:

| Mechanism | When | Level | Purpose |
|---|---|---|---|
| `ModelProfile.fallbackChain` (existing) | Model resolution time | Within a profile | Handle model unavailability (opus unavailable → sonnet) |
| `FallbackStrategy.downshiftChain` (new) | Task retry time | Across profiles | Handle task execution failures (quality profile failed → balanced) |

They compose: `ResolveModelUseCase` first applies per-profile `fallbackChain` to resolve an available model. If the task then fails at runtime, `RetryPolicy.resolveModel()` walks the cross-profile `downshiftChain`.

#### FallbackStrategy

```typescript
FallbackStrategySchema = z.object({
  retryCount: z.number().int().min(0).max(3).default(1),
  downshiftChain: z.array(z.string()).default(["quality", "balanced", "budget"]),
  checkpointBeforeRetry: z.boolean().default(true),
});
```

#### settings.yaml addition

```yaml
fallback:
  retry-count: 1           # retries per profile before downshifting
  downshift-chain:          # cross-profile chain (profile names)
    - quality
    - balanced
    - budget
  checkpoint-before-retry: true
```

#### `SettingsSchema` update

Add `fallback: FallbackStrategySchema.optional()` to `ProjectSettingsSchema` in `project-settings.schemas.ts`. Zod `.default()` provides values when missing from existing settings files.

#### 3-Step Recovery Chain

1. **Retry same model** — attempt ≤ `fallback.retryCount`. Checkpoint committed to worktree branch. Prompt enriched with failure context. Worktree restored via `git checkout .`.
2. **Downshift** — current profile position + 1 in `downshiftChain`. Resolve model via `ResolveModelUseCase` (applies per-profile `fallbackChain` too). Reset attempt counter. Checkpoint committed. Journal `model-downshift`.
3. **Escalate** — end of chain + retries exhausted. Task marked failed. Journal `task-escalated`. Remaining wave tasks continue.

#### RetryPolicy extension

`resolveModel()` **added** to existing interface alongside `shouldRetry()`, `recordFailure()`, `reset()`:

```typescript
abstract class RetryPolicy {
  // existing — unchanged:
  abstract shouldRetry(taskId: string, errorCode: string, attempt: number): RetryDecision;
  abstract recordFailure(taskId: string, errorSignature: string): void;
  abstract reset(taskId: string): void;
  // new:
  abstract resolveModel(taskId: string, currentProfile: string, attempt: number): ModelResolution;
}

ModelResolutionSchema = z.object({
  action: z.enum(["retry", "downshift", "escalate"]),
  profile: z.string(),       // profile name — caller resolves to ResolvedModel via ResolveModelUseCase
  attempt: z.number(),       // current attempt within this profile
});
```

#### TaskMetrics update

- `downshifted: boolean` (was hardcoded false, now computed)
- `finalProfile: string` (new — which profile succeeded, optional)
- `totalAttempts: number` (new — total across all profiles, optional)

---

### Integration: Wave-Level Architecture

**Key constraint:** Tasks within a wave run in parallel via `Promise.allSettled`. Per-task worktree restore (`git checkout .`) during parallel execution would corrupt sibling tasks' work. Therefore retry/downshift operates **between waves**, not within them.

#### Two distinct retry scopes

| Scope | When | What | Existing? |
|---|---|---|---|
| Overseer retry | Mid-dispatch (timeout/abort) | Same model, same wave, single task | Yes — existing loop in `executeTaskWithOverseer()` |
| Downshift retry | Post-wave (after all tasks settle) | Different model, retry wave | New — added by this slice |

The overseer retry loop stays unchanged. It handles mid-execution intervention within a single task dispatch. The new downshift chain wraps around at the wave level.

#### Modified execution flow

```
FOR EACH WAVE:
  ┌─ PRE-DISPATCH GUARD (per task, parallel-safe — no side effects)
  │  preDispatchGuardrail.validate(context)
  │  blocker? → mark task as pre-dispatch-failed, skip dispatch
  │  warning? → journal, continue
  │
  ├─ CHECKPOINT (if fallback.checkpointBeforeRetry, once per wave)
  │  git commit on worktree branch
  │
  ├─ DISPATCH ALL TASKS IN WAVE (parallel, existing)
  │  Each task: dispatch + overseer race (existing loop)
  │  Collect results via Promise.allSettled
  │
  ├─ REFLECTION (per completed task, sequential — after wave settles)
  │  fast path: parse selfReview from AgentResult
  │  full path: fresh dispatch() w/ git diff + ACs (read-only)
  │  blocker? → mark task as reflection-failed
  │  warning? → journal, continue
  │  parse failure? → treat as warning, proceed
  │
  ├─ POST-DISPATCH GUARDRAIL (existing, per wave)
  │  violation? → mark task(s) as guardrail-failed
  │
  └─ COLLECT FAILURES
     all passed? → next wave
     any failed? → RETRY PASS (below)

RETRY PASS (sequential, after wave):
  FOR EACH FAILED TASK:
    retryPolicy.resolveModel(taskId, profile, attempt)
    action = 'retry'     → checkpoint, git checkout ., re-dispatch (safe: sequential)
    action = 'downshift'  → checkpoint, journal model-downshift, re-dispatch
    action = 'escalate'   → journal task-escalated, mark failed permanently
  After retry pass: if any task still failed → escalate; else merge into next wave
```

**Why sequential retry:** After the parallel wave completes, retries run one-at-a-time. This makes `git checkout .` safe — no sibling tasks are running. Retried tasks that succeed have their changes committed before the next retry starts.

#### Scope data: `sliceFilePaths`

`sliceFilePaths` is computed at execution start: union of all task `filePaths` in the slice. Not stored on the Slice aggregate — derived from the task list at runtime.

#### Tier for reflection routing

Reflection tier routing uses the **slice-level** complexity tier (S, F-lite, F-full). All tasks in a slice share the same tier. This is slice metadata from `ExecuteSliceInput.complexity`, not per-task.

#### Git diff range for reflection

Reflection uses `git diff <baseCommit>..HEAD` where `baseCommit` is the checkpoint commit hash (already stored in `Checkpoint.baseCommit`), not `HEAD~1`. This correctly captures all agent changes regardless of commit count.

#### ModelResolution → dispatch config

`RetryPolicy.resolveModel()` returns a `profile` name (string). The caller (`ExecuteSliceUseCase`) then calls `ResolveModelUseCase.execute({ profile })` to resolve it to a `ResolvedModel` (provider + modelId), applying per-profile `fallbackChain` as needed. This keeps `RetryPolicy` as a pure domain port with no infrastructure dependencies.

#### Constructor change

`ExecuteSliceUseCase` gains 1 new dependency: `preDispatchGuardrail: PreDispatchGuardrailPort`

#### Wave-level behavior change

Current behavior: any guardrail blocker aborts the entire execution (`aborted = true; break`). New behavior: guardrail blockers and reflection failures are per-task. Failed tasks enter the retry pass. Only escalated tasks (end of downshift chain) are permanently failed. Wave continues with remaining tasks. **This is a behavioral change to existing code** — wave-level abort is replaced with task-level failure collection.

#### Wiring (execution.extension.ts)

- Register `PreDispatchGuardrailPort` → `ComposablePreDispatchAdapter(rules[])`
- Update `DefaultRetryPolicy` constructor to accept `FallbackStrategy` config from settings

### New Journal Entry Types

All new entry types include `waveIndex` for replay consistency.

| Type | Fields |
|---|---|
| `reflection` | taskId, waveIndex, tier, passed, issues[], triggeredRetry |
| `model-downshift` | taskId, waveIndex, fromProfile, toProfile, reason, attempt |
| `task-escalated` | taskId, waveIndex, reason, totalAttempts, profilesAttempted[] |
| `pre-dispatch-blocked` | taskId, waveIndex, ruleId, severity, message |

### New Files

```
execution/domain/
  ports/pre-dispatch-guardrail.port.ts
  pre-dispatch.schemas.ts
  reflection.schemas.ts
  fallback.schemas.ts

execution/infrastructure/
  guardrails/pre-dispatch/
    scope-containment.rule.ts
    worktree-state.rule.ts
    budget-check.rule.ts
    dependency-check.rule.ts
    tool-policy.rule.ts
  adapters/pre-dispatch/
    composable-pre-dispatch.adapter.ts
    in-memory-pre-dispatch.adapter.ts
```

### Modified Files

```
execution/domain/ports/retry-policy.port.ts        — add resolveModel() (existing methods unchanged)
execution/domain/task-metrics.schemas.ts            — reflectionTier, finalProfile, totalAttempts
execution/domain/journal-entry.schemas.ts           — 4 new entry types with waveIndex
execution/application/execute-slice.use-case.ts     — significant rewrite: wave-level retry pass, per-task failure collection, reflection step, pre-dispatch guard. Replaces wave-level abort with task-level failure.
execution/infrastructure/policies/default-retry-policy.ts — implement resolveModel() with downshift chain
execution/infrastructure/pi/execution.extension.ts  — wire PreDispatchGuardrailPort + fallback config
settings/domain/project-settings.schemas.ts         — add fallback: FallbackStrategySchema to ProjectSettingsSchema
```

## Acceptance Criteria

- **AC1:** Pre-dispatch scope containment — task with `taskFilePaths` outside `sliceFilePaths` produces blocker violation with `ruleId: 'scope-containment'`; task is not dispatched
- **AC2:** Pre-dispatch worktree state — task dispatched on wrong branch or with uncommitted changes produces blocker with `ruleId: 'worktree-state'`; task is not dispatched
- **AC3:** Pre-dispatch budget warning — task with `budgetRemaining < budgetEstimated` produces warning with `ruleId: 'budget-check'`; dispatch proceeds
- **AC4:** Pre-dispatch dependency + tool policy — task with incomplete upstream produces blocker `dependency-check`; agent with disallowed tool produces blocker `tool-policy`
- **AC5:** Layered reflection respects tier — S-tier: fast path only, never full review. F-lite with clean self-review: fast path, no second dispatch. F-lite with concern: full path via fresh `dispatch()` with read-only tools. F-full: always full path
- **AC6:** Reflection blocker enters retry chain — full-path review returns blocker issue → `RetryPolicy.resolveModel()` called → task re-dispatched or escalated. Journal entry `reflection` emitted with `triggeredRetry: true`
- **AC7:** Downshift chain end-to-end — with `retryCount: 1`, task fails on quality → retry quality (attempt 2) → fail → downshift to balanced → retry balanced → fail → downshift to budget → retry budget → fail → escalate. Task marked failed. Journal entries: `model-downshift` for each shift, `task-escalated` at terminal
- **AC8:** Checkpoint committed to worktree branch before each wave and before each sequential retry. When `checkpointBeforeRetry: false`, no checkpoint commit is created. Checkpoint commit verifiable by counting commits between dispatch attempts
- **AC9:** All 4 new journal entry types (`reflection`, `model-downshift`, `task-escalated`, `pre-dispatch-blocked`) emitted with all fields defined in spec (including `waveIndex`). All entries added to `JournalEntrySchema` discriminated union and accepted by `ReplayJournalUseCase` without validation errors
- **AC10:** Pre-dispatch blocker is task-level — blocked task is marked failed, remaining tasks in the wave continue executing. Wave-level abort replaced with task-level failure collection
- **AC11:** Retry pass runs sequentially after wave completes — `git checkout .` is safe because no sibling tasks are executing. Parallel wave tasks are never interrupted by retry

## Non-Goals

- Wave-level downshift (per-task only)
- User notification on downshift (autonomous, journal only)
- Budget enforcement as hard cap (warning severity only)
- Reflection on S-tier full path (fast path only)
- Changes to OverseerPort or OverseerStrategy interfaces
- Tool policy rule definitions beyond placeholder (full G09 in S10)
- Custom downshift chains beyond 3 tiers

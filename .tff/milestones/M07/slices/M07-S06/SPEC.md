# Spec — M07-S06: Execution Pipeline Improvements (G-pre → A → B)

## Problem

The execution pipeline dispatches tasks without pre-validation, has no structured self-review mechanism, and lacks automated recovery from agent failures beyond simple retry. Specifically:

1. **No pre-dispatch checks** — out-of-scope tasks, dirty worktrees, missing dependencies, and disallowed tools are caught only after dispatch (or not at all).
2. **No structured reflection** — agents self-report via a checklist, but blockers aren't caught until post-dispatch guardrails. No git-diff-based review.
3. **No model fallback** — if an agent fails, the same model retries or the task escalates. No downshift to a cheaper/different model.

## Approach

New ports + extend existing use case (Approach A). Three features delivered sequentially: G-pre → A → B.

- **PreDispatchGuardrailPort** — new port with 5 rules, injected into `ExecuteSliceUseCase`
- **Reflection** — layered step in `executeTaskWithOverseer()` using existing `AgentDispatchPort`
- **Model downshift** — `RetryPolicyPort` extended with `resolveModel()`, settings-driven chain

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
  upstreamTaskIds: z.array(z.string()),
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
| Dependency check | `dependency-check` | blocker | ∀ upstream task: status = completed |
| Tool policy | `tool-policy` | blocker | `agentTools ⊆ allowed tools for agent role` |

#### PreDispatchGuardrailRule interface

```typescript
interface PreDispatchGuardrailRule {
  readonly id: string;
  evaluate(context: PreDispatchContext): PreDispatchViolation[];
}
```

#### ComposablePreDispatchAdapter

- Iterates rules, collects violations
- `passed` = zero blocker violations
- Journals `pre-dispatch-blocked` on any violation

#### Integration

- Called in `executeTaskWithOverseer()` BEFORE dispatch
- Blocker → task skipped, marked failed, escalated
- Warning → logged to journal, dispatch proceeds

---

### A: Per-Task Reflection

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
   - Parse agent's `selfReview` from status report (existing in `PiAgentDispatchAdapter`)
   - All dimensions pass + no concerns → `ReflectionResult { passed: true, tier: 'fast' }`
   - Any concern or dimension fail → escalate to full path

2. **Full path** (triggered by fast-path flag OR F-full tier):
   - Same agent, second turn (reuse session)
   - Prompt includes task ACs + `git diff HEAD~1` output
   - Parse structured response → `ReflectionResult`
   - BLOCKER → retry task (counts toward `retryCount`)
   - WARNING → record in journal, proceed
   - PASS → proceed to post-dispatch guardrail

#### Constraints

- Max 1 reflection per task dispatch (no reflection loops)
- Second turn uses same agent session (no new session)
- Reflection blockers feed into retry/downshift chain (B)
- Git diff obtained via `git diff HEAD~1` in worktree
- S-tier tasks: fast path only (no full diff review)

#### TaskMetrics update

- `reflectionPassed: boolean` (was optional, now required)
- `reflectionTier: 'fast' | 'full' | 'skipped'` (new)

---

### B: Model Downshift Fallback

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
  retry-count: 1
  downshift-chain:
    - quality
    - balanced
    - budget
  checkpoint-before-retry: true
```

#### 3-Step Recovery Chain

1. **Retry same model** — attempt ≤ `fallback.retryCount`. Checkpoint saved. Prompt enriched with failure context. Worktree restored.
2. **Downshift** — current profile position + 1 in chain. Resolve model from `model-profiles[next]`. Reset attempt counter. Checkpoint saved. Journal `model-downshift`.
3. **Escalate** — end of chain + retries exhausted. Task marked failed. Journal `task-escalated`. Execution continues with remaining tasks.

#### RetryPolicy extension

```typescript
abstract class RetryPolicyPort {
  // existing:
  abstract shouldRetry(taskId: string, errorCode: string, attempt: number): RetryDecision;
  // new:
  abstract resolveModel(taskId: string, currentProfile: string, attempt: number): ModelResolution;
}

ModelResolutionSchema = z.object({
  action: z.enum(["retry", "downshift", "escalate"]),
  profile: z.string(),
  model: z.string(),
  attempt: z.number(),
});
```

#### TaskMetrics update

- `downshifted: boolean` (was hardcoded false, now computed)
- `finalProfile: string` (new — which profile succeeded)
- `totalAttempts: number` (new — across all profiles)

---

### Integration: Modified executeTaskWithOverseer()

```
PRE-DISPATCH GUARD
│ preDispatchGuardrail.validate(context)
│ blocker? → skip, journal, return failure
│ warning? → journal, continue
↓
CHECKPOINT (if fallback.checkpointBeforeRetry)
↓
DISPATCH + OVERSEER RACE (existing)
│ success? ↓
│ timeout/intervention? → enter retry chain
↓
REFLECTION (new step)
│ fast path: parse selfReview
│ full path: second turn w/ git diff
│ blocker? → enter retry chain
│ warning? → journal, continue
↓
POST-DISPATCH GUARDRAIL (existing)
│ violation? → enter retry chain
↓
SUCCESS → record metrics, return

RETRY CHAIN (unified):
│ retryPolicy.resolveModel(taskId, profile, attempt)
│ action = 'retry'     → checkpoint, restore, loop
│ action = 'downshift'  → checkpoint, journal, loop
│ action = 'escalate'   → mark failed, return
```

#### Constructor change

`ExecuteSliceUseCase` gains 1 new dependency: `preDispatchGuardrail: PreDispatchGuardrailPort`

#### Wiring (execution.extension.ts)

- Register `PreDispatchGuardrailPort` → `ComposablePreDispatchAdapter(rules[])`
- Update `DefaultRetryPolicy` with fallback config from `settings.yaml`

### New Journal Entry Types

| Type | Fields |
|---|---|
| `reflection` | taskId, tier, passed, issues[], triggeredRetry |
| `model-downshift` | taskId, fromProfile, toProfile, reason, attempt |
| `task-escalated` | taskId, reason, totalAttempts, profilesAttempted[] |
| `pre-dispatch-blocked` | taskId, ruleId, severity, message |

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
execution/domain/ports/retry-policy.port.ts       — add resolveModel()
execution/domain/task-metrics.schemas.ts           — reflectionTier, finalProfile, totalAttempts
execution/domain/journal-entry.schemas.ts          — 4 new entry types
execution/application/execute-slice.use-case.ts    — new flow: pre-dispatch → dispatch → reflect → guardrail → retry chain
execution/infrastructure/policies/default-retry-policy.ts — implement resolveModel() with downshift chain
execution/infrastructure/pi/execution.extension.ts — wire PreDispatchGuardrailPort
```

## Acceptance Criteria

- **AC1:** Pre-dispatch guardrails block out-of-scope tasks before dispatch — task with filePaths outside slice scope → blocker violation, task not dispatched
- **AC2:** Pre-dispatch checks dependency completion and tool policy — task with incomplete upstream → blocker; agent with disallowed tool → blocker
- **AC3:** Reflection catches blockers and triggers retry via the downshift chain — agent self-review flags concern → full diff review → blocker → retry triggered
- **AC4:** Layered reflection: fast path skips full review when self-review is clean — clean self-review on F-lite → no second turn. F-full → always full review
- **AC5:** Downshift chain: retry → downshift → escalate works end-to-end — task fails quality → retry quality → fail → balanced → fail → budget → fail → escalate
- **AC6:** Checkpoint saved before every retry
- **AC7:** Sequential dependency: G-pre fully tested before A, A before B (enforced by task wave ordering)
- **AC8:** All 4 new journal entry types (reflection, model-downshift, task-escalated, pre-dispatch-blocked) emitted correctly and replayable via `ReplayJournalUseCase`

## Non-Goals

- Wave-level downshift (per-task only)
- User notification on downshift (autonomous, journal only)
- Budget enforcement as hard cap (warning severity only)
- Custom downshift chains beyond 3 tiers
- Reflection on S-tier tasks (fast path only)
- Changes to OverseerPort or OverseerStrategy interfaces
- Tool policy rule definitions (uses placeholder; full G09 in S10)

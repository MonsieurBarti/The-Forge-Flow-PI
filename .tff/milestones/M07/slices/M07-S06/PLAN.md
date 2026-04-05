# M07-S06: Execution Pipeline Improvements — Implementation Plan

> For agentic workers: execute task-by-task with TDD. Sequential: G-pre → A → B.

**Goal:** Pre-dispatch guardrails (5 rules), layered per-task reflection (fast/full), model downshift fallback (retry → downshift → escalate).
**Architecture:** New `PreDispatchGuardrailPort` + 5 async rules. Reflection via fresh dispatch. `RetryPolicy` extended with `resolveModel()`. Wave-level retry pass (sequential, post-wave).
**Tech Stack:** TypeScript, Zod v4, Vitest, hexagonal architecture.

## File Structure

### New Files (12)

| File | Responsibility |
|---|---|
| `src/hexagons/execution/domain/pre-dispatch.schemas.ts` | PreDispatchContext, Report, Violation schemas |
| `src/hexagons/execution/domain/pre-dispatch-guardrail-rule.ts` | PreDispatchGuardrailRule interface (separate from schemas) |
| `src/hexagons/execution/domain/ports/pre-dispatch-guardrail.port.ts` | Abstract port for pre-dispatch validation |
| `src/hexagons/execution/domain/reflection.schemas.ts` | ReflectionResult, ReflectionIssue schemas |
| `src/hexagons/execution/domain/fallback.schemas.ts` | FallbackStrategy, ModelResolution schemas |
| `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/scope-containment.rule.ts` | taskFilePaths ⊆ sliceFilePaths |
| `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/dependency-check.rule.ts` | ∀ upstream: status = completed |
| `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/worktree-state.rule.ts` | Branch + clean state (async, GitPort) |
| `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/budget-check.rule.ts` | budgetRemaining ≥ estimated |
| `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/tool-policy.rule.ts` | agentTools ⊆ allowed (placeholder) |
| `src/hexagons/execution/infrastructure/adapters/pre-dispatch/composable-pre-dispatch.adapter.ts` | Composes rules → report |
| `src/hexagons/execution/infrastructure/adapters/pre-dispatch/in-memory-pre-dispatch.adapter.ts` | Test double |
| `src/hexagons/execution/application/build-reflection-config.ts` | Builds reflection AgentDispatchConfig |

Note: Rules placed under `infrastructure/adapters/pre-dispatch/rules/` to match existing pattern (`infrastructure/adapters/guardrails/rules/`). Pre-dispatch uses severity `"blocker"|"warning"` (not the existing guardrail `"error"|"warning"|"info"`) because pre-dispatch violations are binary gates (block dispatch or don't), not graded findings.

### Modified Files (10)

| File | Change |
|---|---|
| `src/hexagons/execution/domain/ports/retry-policy.port.ts` | Add `resolveModel()` |
| `src/hexagons/execution/domain/task-metrics.schemas.ts` | Add reflectionTier, finalProfile, totalAttempts |
| `src/hexagons/execution/domain/task-metrics.builder.ts` | Add builder methods for new fields |
| `src/hexagons/execution/domain/journal-entry.schemas.ts` | 4 new entry types + union |
| `src/hexagons/execution/application/execute-slice.use-case.ts` | Major rewrite: pre-dispatch → reflection → retry pass |
| `src/hexagons/execution/application/execute-slice.schemas.ts` | Add `modelResolver` to ExecuteSliceInput |
| `src/hexagons/execution/infrastructure/policies/default-retry-policy.ts` | Implement resolveModel() |
| `src/hexagons/execution/infrastructure/pi/execution.extension.ts` | Wire PreDispatchGuardrailPort |
| `src/hexagons/settings/domain/project-settings.schemas.ts` | Add fallback config |
| `src/hexagons/execution/index.ts` | Barrel exports |

---

## Wave 0 — Foundation Schemas (parallel, no deps)

### T01: Pre-Dispatch Schemas + Rule Interface + Port

**Files:**
- Create `src/hexagons/execution/domain/pre-dispatch.schemas.ts`
- Create `src/hexagons/execution/domain/pre-dispatch.schemas.spec.ts`
- Create `src/hexagons/execution/domain/pre-dispatch-guardrail-rule.ts` (interface, separate from schemas — matches `guardrail-rule.ts` pattern)
- Create `src/hexagons/execution/domain/ports/pre-dispatch-guardrail.port.ts`
**Traces to:** AC1, AC2, AC3, AC4

- [ ] Write test: PreDispatchContextSchema validates well-formed context; rejects missing fields; PreDispatchViolationSchema accepts blocker/warning severity
- [ ] Run `npx vitest run src/hexagons/execution/domain/pre-dispatch.schemas.spec.ts`, verify FAIL
- [ ] Implement:
  - `pre-dispatch.schemas.ts`:
    - `PreDispatchContextSchema` — taskId, sliceId, milestoneId, taskFilePaths, sliceFilePaths, worktreePath?, expectedBranch, agentModel, agentTools, upstreamTasks[{id, status}], budgetRemaining?, budgetEstimated?
    - `PreDispatchViolationSchema` — ruleId (string), severity (`z.enum(["blocker", "warning"])`), message, metadata?
    - `PreDispatchReportSchema` — passed (boolean), violations[], checkedAt (datetime)
  - `pre-dispatch-guardrail-rule.ts`:
    - `PreDispatchGuardrailRule` interface — `{ readonly id: string; evaluate(ctx: PreDispatchContext): Promise<PreDispatchViolation[]> }`
  - `ports/pre-dispatch-guardrail.port.ts`:
    - `PreDispatchGuardrailPort` abstract class — `validate(ctx): Promise<Result<PreDispatchReport, GuardrailError>>`
- [ ] Run test, verify PASS
- [ ] Commit: `feat(M07-S06/T01): add pre-dispatch schemas, rule interface, and port`

### T02: Reflection + Fallback Schemas

**Files:**
- Create `src/hexagons/execution/domain/reflection.schemas.ts`
- Create `src/hexagons/execution/domain/reflection.schemas.spec.ts`
- Create `src/hexagons/execution/domain/fallback.schemas.ts`
- Create `src/hexagons/execution/domain/fallback.schemas.spec.ts`
**Traces to:** AC5, AC6, AC7

- [ ] Write tests: ReflectionResultSchema validates {passed, tier, issues[], reflectedAt}; FallbackStrategySchema validates with defaults; ModelResolutionSchema validates {action, profile, attempt}
- [ ] Run `npx vitest run src/hexagons/execution/domain/reflection.schemas.spec.ts src/hexagons/execution/domain/fallback.schemas.spec.ts`, verify FAIL
- [ ] Implement schemas:
  - `ReflectionIssueSchema` — severity (blocker|warning), description, filePath?
  - `ReflectionResultSchema` — passed, tier (fast|full), issues[], reflectedAt
  - `FallbackStrategySchema` — retryCount (0-3, default 1), downshiftChain (default [quality, balanced, budget]), checkpointBeforeRetry (default true)
  - `ModelResolutionSchema` — action (retry|downshift|escalate), profile (string), attempt (number)
- [ ] Run tests, verify PASS
- [ ] Commit: `feat(M07-S06/T02): add reflection and fallback schemas`

### T03: Journal Entry Types

**Files:**
- Modify `src/hexagons/execution/domain/journal-entry.schemas.ts`
- Modify `src/hexagons/execution/domain/journal-entry.schemas.spec.ts` (if exists, else create)
**Traces to:** AC9

- [ ] Write tests: each of 4 new entry types parses correctly; JournalEntrySchema discriminated union accepts all 16 types
- [ ] Run `npx vitest run src/hexagons/execution/domain/journal-entry.schemas.spec.ts`, verify FAIL
- [ ] Implement 4 new entry schemas extending `JournalEntryBaseSchema`:
  - `ReflectionEntrySchema` — type: "reflection", taskId, waveIndex, tier (fast|full), passed, issues[], triggeredRetry
  - `ModelDownshiftEntrySchema` — type: "model-downshift", taskId, waveIndex, fromProfile, toProfile, reason, attempt
  - `TaskEscalatedEntrySchema` — type: "task-escalated", taskId, waveIndex, reason, totalAttempts, profilesAttempted[]
  - `PreDispatchBlockedEntrySchema` — type: "pre-dispatch-blocked", taskId, waveIndex, ruleId, severity, message
  - Add all 4 to `JournalEntrySchema` discriminated union array
- [ ] Run test, verify PASS
- [ ] Commit: `feat(M07-S06/T03): add 4 new journal entry types`

### T04: Task Metrics + Settings Schema Updates

**Files:**
- Modify `src/hexagons/execution/domain/task-metrics.schemas.ts`
- Modify `src/hexagons/settings/domain/project-settings.schemas.ts`
- Create/modify tests for both
**Traces to:** AC5, AC6, AC7

- [ ] Write tests: TaskMetricsSchema accepts new optional fields with defaults; SettingsSchema accepts fallback config with defaults; SettingsSchema still parses existing settings files (backward compat)
- [ ] Run tests, verify FAIL
- [ ] Implement:
  - `task-metrics.schemas.ts` — add `reflectionTier: z.enum(["fast", "full", "skipped"]).default("skipped")`, `finalProfile: z.string().optional()`, `totalAttempts: z.number().int().nonnegative().optional()`
  - `task-metrics.builder.ts` — add `withReflectionTier()`, `withFinalProfile()`, `withTotalAttempts()` builder methods
  - `project-settings.schemas.ts` — add `FallbackStrategyConfigSchema` following Base + .catch(defaults) pattern; add `fallback: FallbackStrategyConfigSchema.optional()` to `SettingsSchema`; add `FALLBACK_STRATEGY_DEFAULTS`
- [ ] Run tests, verify PASS
- [ ] Commit: `feat(M07-S06/T04): extend task metrics and settings schemas`

---

## Wave 1 — Pre-Dispatch Rules (depend on T01)

### T05: Scope Containment + Dependency Check Rules

**Files:**
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/scope-containment.rule.ts`
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/scope-containment.rule.spec.ts`
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/dependency-check.rule.ts`
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/dependency-check.rule.spec.ts`
**Traces to:** AC1, AC4

- [ ] Write tests:
  - scope-containment: returns blocker when taskFilePaths has path NOT in sliceFilePaths; returns empty when ⊆; handles empty arrays
  - dependency-check: returns blocker when any upstream task status ≠ "completed"; returns empty when all completed; handles empty upstreamTasks
- [ ] Run `npx vitest run src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/scope-containment.rule.spec.ts src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/dependency-check.rule.spec.ts`, verify FAIL
- [ ] Implement:
  - `ScopeContainmentRule` — id: "scope-containment". `evaluate(ctx)`: filter taskFilePaths not in sliceFilePaths → blocker violation per out-of-scope path. Return `Promise.resolve(violations)`.
  - `DependencyCheckRule` — id: "dependency-check". `evaluate(ctx)`: filter upstreamTasks where status ≠ "completed" → blocker per incomplete dep. Return `Promise.resolve(violations)`.
- [ ] Run tests, verify PASS
- [ ] Commit: `feat(M07-S06/T05): add scope-containment and dependency-check rules`

### T06: Worktree State Rule

**Files:**
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/worktree-state.rule.ts`
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/worktree-state.rule.spec.ts`
**Traces to:** AC2

- [ ] Write tests:
  - Returns blocker when branch ≠ expectedBranch (mock GitPort)
  - Returns blocker when uncommitted changes detected (mock GitPort)
  - Returns empty when branch matches and worktree clean
  - Returns empty (skip) when worktreePath is undefined
- [ ] Run `npx vitest run src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/worktree-state.rule.spec.ts`, verify FAIL
- [ ] Implement `WorktreeStateRule` — id: "worktree-state". Constructor receives `GitPort`. `evaluate(ctx)`: if no worktreePath → return []. Use `gitPort.exec(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: worktreePath })` to get current branch → check vs expectedBranch. Use `gitPort.exec(["status", "--porcelain"], { cwd: worktreePath })` to detect uncommitted changes → blocker if output non-empty. Note: if `GitPort` lacks `exec()` or a `cwd`-aware branch method, shell out via the adapter layer or add a `currentBranchAt(cwd)` method to `GitPort` in this task.
- [ ] Run test, verify PASS
- [ ] Commit: `feat(M07-S06/T06): add worktree-state pre-dispatch rule`

### T07: Budget Check + Tool Policy Rules

**Files:**
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/budget-check.rule.ts`
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/budget-check.rule.spec.ts`
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/tool-policy.rule.ts`
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/tool-policy.rule.spec.ts`
**Traces to:** AC3, AC4

- [ ] Write tests:
  - budget-check: returns warning when budgetRemaining < budgetEstimated; returns empty when ≥; returns empty when either undefined
  - tool-policy: returns blocker when agentTools contains disallowed tool; returns empty when ⊆ allowed; placeholder allowed list (all tools allowed by default)
- [ ] Run tests, verify FAIL
- [ ] Implement:
  - `BudgetCheckRule` — id: "budget-check", severity: "warning". Skip when budget fields undefined.
  - `ToolPolicyRule` — id: "tool-policy", severity: "blocker". Constructor receives `allowedTools: Map<string, string[]>` (agentType → tools). Placeholder: allow all by default (full G09 in S10).
- [ ] Run tests, verify PASS
- [ ] Commit: `feat(M07-S06/T07): add budget-check and tool-policy rules`

### T08: Composable Pre-Dispatch Adapter + Test Double

**Files:**
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/composable-pre-dispatch.adapter.ts`
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/composable-pre-dispatch.adapter.spec.ts`
- Create `src/hexagons/execution/infrastructure/adapters/pre-dispatch/in-memory-pre-dispatch.adapter.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC10

- [ ] Write tests:
  - Runs all rules (not short-circuit) — rule A blockers + rule B blockers both present
  - `passed = true` when zero blockers (warnings only → passed)
  - `passed = false` when any blocker exists
  - Reports correct checkedAt timestamp
  - InMemory adapter: can preset pass/fail reports
- [ ] Run `npx vitest run src/hexagons/execution/infrastructure/adapters/pre-dispatch/composable-pre-dispatch.adapter.spec.ts`, verify FAIL
- [ ] Implement:
  - `ComposablePreDispatchAdapter extends PreDispatchGuardrailPort` — constructor receives `PreDispatchGuardrailRule[]`. `validate(ctx)`: run all rules via `Promise.all(rules.map(r => r.evaluate(ctx)))`, flatten violations, set `passed = !violations.some(v => v.severity === "blocker")`. Return `ok({ passed, violations, checkedAt })`.
  - `InMemoryPreDispatchAdapter extends PreDispatchGuardrailPort` — configurable preset: `setReport(report)`, `validate()` returns preset or default (passed: true).
- [ ] Run tests, verify PASS
- [ ] Commit: `feat(M07-S06/T08): add composable pre-dispatch adapter and test double`

---

## Wave 2 — Retry Policy + Reflection (depend on T02, T03)

### T09: RetryPolicy Extension + DefaultRetryPolicy resolveModel

**Files:**
- Modify `src/hexagons/execution/domain/ports/retry-policy.port.ts`
- Modify `src/hexagons/execution/infrastructure/policies/default-retry-policy.ts`
- Create `src/hexagons/execution/infrastructure/policies/default-retry-policy.spec.ts`
**Traces to:** AC7

- [ ] Write tests:
  - resolveModel with attempt < retryCount → returns `{ action: "retry", profile: currentProfile, attempt }`
  - resolveModel with attempt ≥ retryCount and next profile exists → returns `{ action: "downshift", profile: nextProfile, attempt: 0 }`
  - resolveModel at end of chain + retries exhausted → returns `{ action: "escalate", profile: currentProfile, attempt }`
  - Full chain: quality(0) → quality(1) → balanced(0) → balanced(1) → budget(0) → budget(1) → escalate
  - Existing shouldRetry/recordFailure/reset still work unchanged
- [ ] Run `npx vitest run src/hexagons/execution/infrastructure/policies/default-retry-policy.spec.ts`, verify FAIL
- [ ] Implement:
  - `retry-policy.port.ts`: add `abstract resolveModel(taskId: string, currentProfile: string, attempt: number): ModelResolution;` — import `ModelResolution` from `../fallback.schemas`
  - `default-retry-policy.ts`: add `downshiftChain: string[]` and `retryCountPerProfile: number` to constructor. `resolveModel()` is **stateless** — caller tracks attempt number. Logic: if `attempt <= retryCountPerProfile` → action: "retry" (same profile). Else find next profile in `downshiftChain` → action: "downshift" (attempt resets to 0). Else end of chain → action: "escalate". With `retryCountPerProfile: 1`: attempt 0 = initial, attempt 1 = retry, attempt 2 → downshift.
- [ ] Run tests, verify PASS
- [ ] Commit: `feat(M07-S06/T09): extend RetryPolicy with resolveModel and downshift chain`

### T10: Reflection Config Builder

**Files:**
- Create `src/hexagons/execution/application/build-reflection-config.ts`
- Create `src/hexagons/execution/application/build-reflection-config.spec.ts`
**Traces to:** AC5, AC6

- [ ] Write tests:
  - Builds AgentDispatchConfig with taskId: `{originalId}-reflection`
  - Uses read-only tools: ["Read", "Glob", "Grep", "Bash"]
  - Includes ACs and git diff in taskPrompt
  - Uses same model and agentType as original config
  - systemPrompt is reflection-focused (review, not implementation)
- [ ] Run `npx vitest run src/hexagons/execution/application/build-reflection-config.spec.ts`, verify FAIL
- [ ] Implement `buildReflectionConfig(params: { originalConfig: AgentDispatchConfig; acceptanceCriteria: string; gitDiff: string; })`: returns `AgentDispatchConfig` with reflection prompt template, read-only tools, and `{taskId}-reflection` ID.
- [ ] Run test, verify PASS
- [ ] Commit: `feat(M07-S06/T10): add reflection config builder`

---

## Wave 3 — Use-Case Integration (depends on T01–T10)

### T11: ExecuteSliceUseCase — Pre-Dispatch Guard + Per-Task Failure Collection

**Files:**
- Modify `src/hexagons/execution/application/execute-slice.use-case.ts`
- Modify/create `src/hexagons/execution/application/execute-slice.use-case.spec.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC10

- [ ] Write integration tests:
  - Pre-dispatch blocker → task NOT dispatched, journal entry `pre-dispatch-blocked` emitted, task marked failed
  - Pre-dispatch warning → task dispatched, journal entry emitted, execution continues
  - Pre-dispatch blocker is task-level: blocked task fails, sibling tasks in wave still dispatched and succeed
  - Wave-level abort removed: wave with 1 failure + 1 success → success task's work preserved
- [ ] Run tests, verify FAIL
- [ ] Implement:
  - Add `preDispatchGuardrail: PreDispatchGuardrailPort` to `ExecuteSliceUseCaseDeps`
  - Compute `sliceFilePaths` at execute() start: union of all task filePaths
  - Before each dispatch: call `preDispatchGuardrail.validate(context)`. Build PreDispatchContext from task + slice data.
  - Blocker → skip dispatch, mark task failed, journal `pre-dispatch-blocked`
  - Warning → journal, continue dispatch
  - Replace wave-level `aborted = true; break` on task failure with per-task failure collection
  - Collect `retriableFailures[]` instead of immediate abort
- [ ] Run tests, verify PASS
- [ ] Commit: `feat(M07-S06/T11): integrate pre-dispatch guard with per-task failure collection`

### T12: ExecuteSliceUseCase — Reflection Step

**Files:**
- Modify `src/hexagons/execution/application/execute-slice.use-case.ts`
- Modify tests
**Traces to:** AC5, AC6

- [ ] Write integration tests:
  - S-tier task with clean self-review → fast path, reflectionTier: "fast", no second dispatch
  - F-full task → always full path, second dispatch with reflection config
  - F-lite task with concern → full path triggered
  - Reflection blocker → task enters retriableFailures (counts as failure)
  - Reflection warning → journal entry, task proceeds to guardrail
  - Reflection parse failure → treated as warning, task proceeds
- [ ] Run tests, verify FAIL
- [ ] Implement:
  - After wave tasks settle (Promise.allSettled), run reflection **sequentially** per completed task
  - Fast path: check `agentResult.selfReview.dimensions` all passed + no concerns + status "DONE" → ReflectionResult {passed: true, tier: "fast"}
  - Full path trigger: any dimension failed OR concerns OR F-full tier
  - Full path: `buildReflectionConfig()` + `agentDispatch.dispatch(reflectionConfig)`, parse output with `TFF_REFLECTION_REPORT` markers → ReflectionResult
  - Parse failure → warning (log + proceed)
  - Blocker → add task to retriableFailures
  - Journal `reflection` entry for every reflected task
- [ ] Run tests, verify PASS
- [ ] Commit: `feat(M07-S06/T12): integrate layered reflection step`

### T13: ExecuteSliceUseCase — Retry/Downshift Pass

**Files:**
- Modify `src/hexagons/execution/application/execute-slice.use-case.ts`
- Modify tests
**Traces to:** AC7, AC8, AC11

- [ ] Write integration tests:
  - Failed task → retryPolicy.resolveModel returns "retry" → checkpoint committed, worktree restored, task re-dispatched with same model
  - Failed task → resolveModel returns "downshift" → checkpoint committed, journal `model-downshift`, task re-dispatched with downshifted model via `modelResolver`
  - Failed task → resolveModel returns "escalate" → journal `task-escalated`, task permanently failed
  - Full chain: quality(0) → quality(1) → quality(2=downshift) → balanced(0) → balanced(1) → balanced(2=downshift) → budget(0) → budget(1) → budget(2=escalate) (with retryCount: 1)
  - Retry pass runs sequentially (verify ordering)
  - checkpointBeforeRetry: false → no checkpoint commits during retry
  - Guardrail blocker enters retry pass (not wave-level abort)
- [ ] Run tests, verify FAIL
- [ ] Implement:
  - Add `modelResolver: (profileName: string) => ResolvedModel` to `ExecuteSliceUseCaseDeps` — injected function wrapping `ResolveModelUseCase`. This keeps the execution hexagon decoupled from settings hexagon. Wired at extension level.
  - After wave completes + reflection, collect `retriableFailures`
  - Sequential retry pass: for each failed task, call `retryPolicy.resolveModel(taskId, currentProfile, attempt)`
    - "retry" → checkpoint.save(), gitPort.restoreWorktree(), re-dispatch with same config
    - "downshift" → checkpoint.save(), call `modelResolver(newProfile)` to get `ResolvedModel`, journal `model-downshift`, re-dispatch with new config
    - "escalate" → journal `task-escalated`, add to permanentFailures
  - After retry pass: if permanentFailures exist → set those in result.failedTasks
  - Update guardrail blocker handling: add to retriableFailures instead of `aborted = true; break`
- [ ] Run tests, verify PASS
- [ ] Commit: `feat(M07-S06/T13): integrate retry/downshift pass with sequential recovery`

---

## Wave 4 — Wiring + Exports (depends on T11–T13)

### T14: Execution Extension Wiring + Barrel Exports

**Files:**
- Modify `src/hexagons/execution/infrastructure/pi/execution.extension.ts`
- Modify `src/hexagons/execution/index.ts`
- Modify `src/cli/extension.ts` (if wiring lives there)
**Traces to:** All ACs (integration)

- [ ] Wire `ComposablePreDispatchAdapter` with all 5 rules in execution extension
- [ ] Wire `DefaultRetryPolicy` with `FallbackStrategy` config from settings
- [ ] Pass `PreDispatchGuardrailPort` to `ExecuteSliceUseCase` constructor
- [ ] Update barrel exports in `execution/index.ts`:
  - Export: `PreDispatchGuardrailPort`, `ComposablePreDispatchAdapter`, `InMemoryPreDispatchAdapter`
  - Export: schemas (PreDispatchContext, PreDispatchReport, ReflectionResult, FallbackStrategy, ModelResolution)
  - Export: all 5 rules
  - Export: `buildReflectionConfig`
  - Export: new journal entry types
- [ ] Run full test suite: `npx vitest run --reporter=verbose`
- [ ] Commit: `feat(M07-S06/T14): wire pre-dispatch guardrails and update barrel exports`

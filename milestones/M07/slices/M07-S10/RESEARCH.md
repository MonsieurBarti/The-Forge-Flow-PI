# Research — M07-S10: Gap Features (G09, G04, G02, G03)

## Overview

4 independent features sharing settings hexagon as integration point. Research focused on exact current state, integration points, and implementation risks per feature.

---

## G09: Configurable Tool/Command Rules Per Agent

### Current State

**ToolPolicyRule** (`execution/infrastructure/adapters/pre-dispatch/rules/tool-policy.rule.ts`):
- Constructor: `ReadonlyMap<string, readonly string[]>` (default empty Map)
- Lookup key: `context.agentModel` (format: `"provider/modelId"`)
- If no policy for model → returns empty (permissive)
- Violation severity: `"blocker"`

**PreDispatchContextSchema** (`execution/domain/pre-dispatch.schemas.ts`):
- Fields: `taskId, sliceId, milestoneId, taskFilePaths, sliceFilePaths, worktreePath, expectedBranch, agentModel, agentTools, upstreamTasks, budgetRemaining?, budgetEstimated?`
- Missing: `agentRole`, `complexityTier` — needed for G09

**PromptBuilder** (`execution/infrastructure/prompt-builder.ts`):
- Hardcodes `agentType: "executor"` and `tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]`
- AgentDispatchConfig carries `agentType` but it's always "executor" in execution context

**ComposablePreDispatchAdapter** (`execution/infrastructure/adapters/pre-dispatch/composable-pre-dispatch.adapter.ts`):
- Rules executed in parallel via `Promise.all()`
- Fails if ANY blocker violation exists
- Wired in `extension.ts` (lines 314-320) with `new ToolPolicyRule()` (empty)

**Settings pattern** (`settings/domain/project-settings.schemas.ts`):
- Schema structure: `Base*Schema` → `*_DEFAULTS` → `*Schema = Base*Schema.catch(*_DEFAULTS)` → included in `SettingsSchema` with `.default()`
- Current sections: modelRouting, autonomy, autoLearn, beads, guardrails, overseer, hotkeys, fallback?

### Changes Required

| File | Change |
|---|---|
| `pre-dispatch.schemas.ts` | Add `agentRole: z.string()`, `complexityTier: ComplexityTierSchema` |
| `tool-policy.rule.ts` | Refactor constructor to accept `ToolPoliciesConfig`; evaluate via merge chain (defaults → tier → role) |
| `execute-slice.use-case.ts` | Populate `agentRole` and `complexityTier` in pdContext (lines 336-350) |
| `project-settings.schemas.ts` | Add `ToolPoliciesConfigSchema` section with `BaseToolPoliciesConfigSchema` + `.catch()` + defaults |
| `project-settings.value-object.ts` | Add `get toolPolicies()` getter |
| `extension.ts` | Read settings → pass `toolPolicies` config to `ToolPolicyRule` constructor |

### Risks

- **PromptBuilder hardcodes tools**: Currently always `["Read", "Write", "Edit", "Bash", "Glob", "Grep"]`. ToolPolicyRule filtering happens at pre-dispatch but doesn't modify the actual tool list sent to the agent. The rule blocks dispatch entirely if tools violate policy. This is correct behavior (block, not filter) but worth noting.
- **AgentType sources**: `AgentTypeSchema` has 7 values (`executor, spec-reviewer, code-reviewer, security-auditor, fixer, verifier, doc-writer`). These map to agent roles for policy lookup.

---

## G02: Failure Policy Model

### Current State

**Transition table** (`workflow/domain/transition-table.ts`):
- 19 rules total, 7 active phases
- Single failure path: `*active* + fail → blocked` (guard: `retriesExhausted`)
- `retriesExhausted`: `ctx.retryCount >= ctx.maxRetries`

**Phase-to-success-trigger mapping** (from transition table):
```
discussing   → "next"    (→ researching or planning depending on tier guard)
researching  → "next"    (→ planning)
planning     → "approve" (→ executing)
executing    → "next"    (→ verifying)
verifying    → "approve" (→ reviewing)
reviewing    → "approve" (→ shipping)
shipping     → "next"    (→ idle + clearSlice)
```

**GuardContextSchema** (`workflow/domain/workflow-session.schemas.ts`, lines 81-88):
- Fields: `complexityTier, retryCount, maxRetries, allSlicesClosed, lastError`
- Missing: `failurePolicy`

**WorkflowSession.trigger()** (`workflow/domain/workflow-session.aggregate.ts`):
- `findMatchingRules(phase, trigger)` → candidate rules
- Evaluates guards in order, picks first passing rule
- All rules fail → returns error with list of failed guards
- On blocked → creates Escalation, emits `WorkflowEscalationRaisedEvent`

**OrchestratePhaseTransitionUseCase** (`workflow/use-cases/orchestrate-phase-transition.use-case.ts`):
- Input: `{ milestoneId?, sliceId?, trigger, guardContext }`
- Calls `session.trigger()` → maps phase to slice status → saves → publishes events
- Does NOT currently read failure policies or handle lenient bypass

**Journal entry types** (`execution/domain/journal-entry.schemas.ts`):
- 16 existing types including `TaskFailedEntry`, `OverseerInterventionEntry`, `TaskEscalatedEntry`, `PreDispatchBlockedEntry`
- Missing: `FailureRecordedEntry`

**GuardContext built in**:
- `WorkflowTransitionTool` (lines 48-59) — from session + slice repo + settings
- `QuickStartUseCase` (lines 118-124) — hardcoded nulls

### Changes Required

| File | Change |
|---|---|
| `project-settings.schemas.ts` | Add `FailurePoliciesConfigSchema` under new `workflow` section |
| `project-settings.value-object.ts` | Add `get workflow()` getter |
| `workflow-session.schemas.ts` | Add `failurePolicy: FailurePolicyModeSchema` to `GuardContextSchema` |
| `orchestrate-phase-transition.use-case.ts` | Read failure policy; on failure: strict→trigger fail, tolerant→journal+trigger fail, lenient→journal+trigger success |
| `journal-entry.schemas.ts` | Add `FailureRecordedEntrySchema` |
| `workflow-transition.tool.ts` | Include `failurePolicy` when building guard context |
| `quick-start.use-case.ts` | Include `failurePolicy` when building guard context |

### Critical Design Decision

**Lenient mode bypass**: When failure occurs in lenient mode, `OrchestratePhaseTransitionUseCase` must NOT call `session.trigger("fail")`. Instead:
1. Record `FailureRecordedEntry` with `action: "continued"`
2. Call success trigger for current phase (e.g., `executing` → `trigger("next")`)
3. Skip escalation creation

**discussing phase edge case**: `discussing → next` has two transitions guarded by `notSTier`/`isSTier`. Lenient bypass from discussing would need to pass the tier guard. Since failures during discussing are unusual (it's an interactive phase), lenient mode for discussing should fall through to strict behavior.

**shipping phase edge case**: `shipping → next` has effect `clearSlice + resetRetryCount`. Lenient bypass from shipping would clear the slice. This is likely correct (ship succeeded but with warnings).

---

## G03: Per-Stage Quality Metrics

### Current State

**TaskMetricsSchema** (`execution/domain/task-metrics.schemas.ts`):
- Fields: taskId, sliceId, milestoneId, model, tokens, costUsd, durationMs, success, retries, downshifted, reflectionPassed, reflectionTier, finalProfile?, totalAttempts?, turns[], timestamp
- Missing: `phase`, `type` discriminator

**MetricsRepositoryPort** (`execution/domain/ports/metrics-repository.port.ts`):
- Methods: `append(TaskMetrics)`, `readBySlice(sliceId)`, `readByMilestone(milestoneId)`, `readAll()`
- All typed for `TaskMetrics` only

**MetricsQueryPort** (`execution/domain/ports/metrics-query.port.ts`):
- Methods: `aggregateBySlice(sliceId)`, `aggregateByMilestone(milestoneId)`
- No phase-aware queries

**JsonlMetricsRepository** (`execution/infrastructure/repositories/metrics/jsonl-metrics.repository.ts`):
- `append()`: serializes entry, appends line to `metrics.jsonl`
- `readAll()`: reads file, parses each line via `TaskMetricsSchema.safeParse()`, silently skips failures
- `readBySlice/readByMilestone`: calls `readAll()` + filter

**InMemoryMetricsRepository** (`execution/infrastructure/repositories/metrics/in-memory-metrics.repository.ts`):
- Simple `TaskMetrics[]` store with filter methods

**RecordTaskMetricsUseCase** (`execution/application/record-task-metrics.use-case.ts`):
- Event-driven: subscribes to `TaskExecutionCompletedEvent`
- Maps event → `TaskMetrics` → `metricsRepo.append()`
- Event has no phase information — phase must be injected externally

**AggregateMetricsUseCase** (`execution/application/aggregate-metrics.use-case.ts`):
- Aggregates: totalCostUsd, totalInputTokens, totalOutputTokens, totalDurationMs, taskCount, successCount, failureCount, averageCostPerTask, modelBreakdown
- Groups by sliceId or milestoneId only

**Contract tests** (`execution/infrastructure/repositories/metrics/metrics-repository.contract.spec.ts`):
- Tests: round-trip, slice filter, milestone filter, empty reads, field preservation

### Changes Required

| File | Change |
|---|---|
| `task-metrics.schemas.ts` | Add `phase: WorkflowPhaseSchema.default("executing")`, `type: z.literal("task-metrics").default("task-metrics")`; create `QualitySnapshotSchema` |
| `metrics-repository.port.ts` | Extend `append()` to accept `TaskMetrics \| QualitySnapshot`; add `readQualitySnapshots(sliceId)` |
| `metrics-query.port.ts` | Add `queryByPhase()`, `aggregateByPhase()`, `getQualitySnapshots()` |
| `jsonl-metrics.repository.ts` | Type discriminator parse logic; quality snapshot filter methods |
| `in-memory-metrics.repository.ts` | Union type store; type-filtered read methods |
| `aggregate-metrics.use-case.ts` | Add `aggregateByPhase()` method |
| `record-task-metrics.use-case.ts` | Inject phase resolver; add phase to TaskMetrics |
| `metrics-repository.contract.spec.ts` | Quality snapshot tests; phase filter tests; type discrimination |
| `orchestrate-phase-transition.use-case.ts` | Capture QualitySnapshot at phase boundaries (if enabled) |

### Backward Compatibility

- Existing `metrics.jsonl` entries lack `type` field → `z.literal("task-metrics").default("task-metrics")` handles this
- Existing entries lack `phase` field → `.default("executing")` handles this
- `readAll()` currently skips unparseable lines → quality snapshots will be silently skipped by old code

### Quality Snapshot Data Sources

| Field | Source | Available at phase boundary? |
|---|---|---|
| toolInvocations | Sum of `turn.toolCalls.length` from TaskMetrics in phase | Yes (from recorded metrics) |
| toolFailures | Sum of `turn.toolCalls.filter(tc => tc.isError).length` | Yes (from recorded metrics) |
| filesChanged | `git diff --stat` | Yes (via GitPort) |
| linesAdded/Removed | `git diff --numstat` | Yes (via GitPort) |
| testsPassed/Failed/Skipped | Not currently parsed from output | Default to 0 |
| lintErrors | Not currently parsed from output | Default to 0 |
| reviewScore | From review hexagon (ReviewResult) | Available after reviewing phase |

---

## G04: Stack Auto-Discovery

### Current State

**InitProjectUseCase** (`project/use-cases/init-project.use-case.ts`):
- Creates `.tff/` dirs (milestones, skills, observations)
- Writes `PROJECT.md`
- Calls `MergeSettingsUseCase` with empty sources → generates defaults
- Serializes to YAML via `stringify()` → writes via `projectFs.writeFile()`
- Dependencies: `ProjectRepositoryPort, ProjectFileSystemPort, MergeSettingsUseCase, EventBusPort, DateProviderPort, GitHookPort?`

**ProjectFileSystemPort** (`project/domain/ports/project-filesystem.port.ts`):
- Methods: `exists(path)`, `createDirectory(path, opts?)`, `writeFile(path, content)`
- No `readFile()` method — read-only for existence checks, write-only for content

**SettingsFilePort** (`settings/domain/ports/settings-file.port.ts`):
- Methods: `readFile(path)` only
- No `writeFile()` method

**SaveSettingsUseCase**: Does NOT exist. Settings writes happen via:
- `InitProjectUseCase` → `projectFs.writeFile()` (raw YAML)
- `settings-update.tool.ts` → direct `fs.writeFileSync()` (no port)

**Cross-hexagon pattern**: Project hexagon imports `MergeSettingsUseCase` from settings hexagon. Dependency is unidirectional (project → settings).

### Changes Required

| File | Change |
|---|---|
| `project-settings.schemas.ts` | Add `StackConfigSchema` with `detected` and `overrides` sub-objects |
| `project-settings.value-object.ts` | Add `get stack()` getter |
| `settings-file.port.ts` | Add `writeFile(path, content)` method |
| `fs-settings-file.adapter.ts` | Implement `writeFile()` |
| `in-memory-settings-file.adapter.ts` | Implement `writeFile()` |
| New: `discover-stack.use-case.ts` | Create in settings hexagon (not project — keeps detection logic with settings domain) |
| `init-project.use-case.ts` | Call `DiscoverStackUseCase` after creating .tff/, merge detected stack into settings before writing |
| `project.extension.ts` | Add `DiscoverStackUseCase` dependency |
| `extension.ts` | Wire `DiscoverStackUseCase` to `InitProjectUseCase` |

### Hexagon Placement Decision

**Spec says**: settings hexagon. **Research confirms**: correct. `DiscoverStackUseCase` needs filesystem read access (to scan `package.json`, etc.) and settings write access. Placing in settings hexagon:
- Avoids new cross-hexagon dependency (settings → project)
- Filesystem reading can use `SettingsFilePort` (after adding `readFile` — already exists) or a new `StackDiscoveryPort`
- `InitProjectUseCase` already depends on settings hexagon

**Simpler alternative**: Use `SettingsFilePort.readFile()` to read `package.json` etc. (it already reads arbitrary files). No new port needed.

### Detection Logic

```
1. readFile("package.json") → parse JSON → extract deps/devDeps
   - Has "react"/"react-dom" → framework: "react"
   - Has "next" → framework: "next"
   - Has "express" → framework: "express"
   - Has "typescript" in devDeps → runtime: "typescript"
   - Else → runtime: "node"

2. Check lock files (exists check via SettingsFilePort):
   - "pnpm-lock.yaml" → packageManager: "pnpm"
   - "package-lock.json" → packageManager: "npm"
   - "yarn.lock" → packageManager: "yarn"

3. Check config files:
   - "vitest.config.ts" or "vitest.config.js" → testRunner: "vitest"
   - "jest.config.ts" or "jest.config.js" → testRunner: "jest"
   - "biome.json" or "biome.jsonc" → linter: "biome"
   - ".eslintrc*" → linter: "eslint"

4. Check tsconfig:
   - "tsconfig.json" exists → buildTool: "tsc" (unless vite/webpack detected)
```

---

## Cross-Cutting: Settings Schema Structure

All 4 features add to `SettingsSchema`. Unified addition pattern:

```typescript
// 1. Base schema
const BaseToolPoliciesConfigSchema = z.object({ ... });
const BaseFailurePoliciesConfigSchema = z.object({ ... });
const BaseQualityMetricsConfigSchema = z.object({ ... });
const BaseStackConfigSchema = z.object({ ... });

// 2. Defaults
export const TOOL_POLICIES_DEFAULTS = { ... };
export const FAILURE_POLICIES_DEFAULTS = { ... };
export const QUALITY_METRICS_DEFAULTS = { perPhaseTracking: true };
export const STACK_DEFAULTS = { detected: {}, overrides: {} };

// 3. Resilient schemas
export const ToolPoliciesConfigSchema = BaseToolPoliciesConfigSchema.catch(TOOL_POLICIES_DEFAULTS);
export const FailurePoliciesConfigSchema = BaseFailurePoliciesConfigSchema.catch(FAILURE_POLICIES_DEFAULTS);
export const QualityMetricsConfigSchema = BaseQualityMetricsConfigSchema.catch(QUALITY_METRICS_DEFAULTS);
export const StackConfigSchema = BaseStackConfigSchema.catch(STACK_DEFAULTS);

// 4. Add to SettingsSchema
export const SettingsSchema = z.object({
  // ... existing sections ...
  toolPolicies: ToolPoliciesConfigSchema.default(TOOL_POLICIES_DEFAULTS),
  workflow: z.object({
    failurePolicies: FailurePoliciesConfigSchema.default(FAILURE_POLICIES_DEFAULTS),
  }).default({ failurePolicies: FAILURE_POLICIES_DEFAULTS }),
  qualityMetrics: QualityMetricsConfigSchema.default(QUALITY_METRICS_DEFAULTS),
  stack: StackConfigSchema.default(STACK_DEFAULTS),
}).default(SETTINGS_DEFAULTS);
```

YAML keys are kebab-case in file, auto-converted to camelCase by `LoadSettingsUseCase.normalizeKeys()`.

---

## Architecture Review

| Aspect | Status | Finding |
|---|---|---|
| Layer dependency | pass | All changes follow domain ← app ← infra direction |
| Module boundaries | pass | Each feature modifies its own hexagon + settings |
| Port coverage | **warning** | `SettingsFilePort` needs `writeFile()` for G04 |
| Cross-cutting concerns | pass | Settings hexagon is shared integration point (existing pattern) |

---

## File Impact Summary

| Hexagon | Files Modified | Files Created |
|---|---|---|
| Settings | 4 (schemas, VO, port, adapters) | 1 (DiscoverStackUseCase) |
| Execution | 7 (pre-dispatch, metrics schemas, repos, use cases) | 1 (QualitySnapshotSchema — in existing file) |
| Workflow | 5 (guards, transitions, orchestrator, tools, journal) | 0 |
| Project | 2 (init use case, extension) | 0 |
| CLI | 1 (extension.ts wiring) | 0 |
| **Total** | **19** | **2** |

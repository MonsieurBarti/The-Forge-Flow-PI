# M07-S10: Gap Features (G09, G04, G02, G03) — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Implement 4 gap features: configurable tool policies (G09), stack auto-discovery (G04), per-phase failure policies (G02), and per-stage quality metrics (G03).

**Architecture:** Settings-first, then feature-parallel. All features extend `ProjectSettingsSchema` first (Wave 0), then implement domain schemas (Wave 1), use cases (Wave 2), and integration wiring (Wave 3). Contract tests close in Wave 4.

**Tech Stack:** TypeScript, Zod v4, Vitest, hexagonal architecture, JSONL persistence.

## File Structure

### Settings Hexagon
- `src/hexagons/settings/domain/project-settings.schemas.ts` — New config schemas (ToolPolicies, FailurePolicies, QualityMetrics, Stack)
- `src/hexagons/settings/domain/project-settings.value-object.ts` — New getters
- `src/hexagons/settings/domain/ports/settings-file.port.ts` — Add writeFile()
- `src/hexagons/settings/infrastructure/fs-settings-file.adapter.ts` — Implement writeFile()
- `src/hexagons/settings/infrastructure/in-memory-settings-file.adapter.ts` — Implement writeFile()
- `src/hexagons/settings/use-cases/discover-stack.use-case.ts` — G04 detection logic
- `src/hexagons/settings/index.ts` — Exports

### Execution Hexagon
- `src/hexagons/execution/domain/pre-dispatch.schemas.ts` — G09 context enrichment
- `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/tool-policy.rule.ts` — G09 refactor
- `src/hexagons/execution/domain/task-metrics.schemas.ts` — G03 phase + QualitySnapshot
- `src/hexagons/execution/domain/ports/metrics-repository.port.ts` — G03 union type
- `src/hexagons/execution/domain/ports/metrics-query.port.ts` — G03 phase methods
- `src/hexagons/execution/infrastructure/repositories/metrics/jsonl-metrics.repository.ts` — G03 discriminator
- `src/hexagons/execution/infrastructure/repositories/metrics/in-memory-metrics.repository.ts` — G03 union
- `src/hexagons/execution/application/record-task-metrics.use-case.ts` — G03 phase injection
- `src/hexagons/execution/application/aggregate-metrics.use-case.ts` — G03 phase aggregation
- `src/hexagons/execution/application/execute-slice.use-case.ts` — G09 pdContext
- `src/hexagons/execution/domain/journal-entry.schemas.ts` — G02 FailureRecordedEntry

### Workflow Hexagon
- `src/hexagons/workflow/domain/workflow-session.schemas.ts` — G02 failurePolicy in GuardContext
- `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.ts` — G02 routing + G03 capture
- `src/hexagons/workflow/infrastructure/pi/workflow-transition.tool.ts` — G02 guard context
- `src/hexagons/workflow/use-cases/quick-start.use-case.ts` — G02 guard context

### Project Hexagon
- `src/hexagons/project/use-cases/init-project.use-case.ts` — G04 integration
- `src/hexagons/project/infrastructure/pi/project.extension.ts` — G04 wiring

### CLI
- `src/cli/extension.ts` — G09 + G04 wiring

---

## Wave 0 (foundation)

### T01: Settings Schemas + Value Object Getters
**Files:**
- Modify: `src/hexagons/settings/domain/project-settings.schemas.ts`
- Modify: `src/hexagons/settings/domain/project-settings.schemas.spec.ts`
- Modify: `src/hexagons/settings/domain/project-settings.value-object.ts`
- Modify: `src/hexagons/settings/domain/project-settings.value-object.spec.ts`
- Modify: `src/hexagons/settings/index.ts`
**Traces to:** AC3, AC5, AC9, AC12
**Deps:** none

- [ ] Step 1: Write failing tests for new schema sections (toolPolicies, workflow.failurePolicies, qualityMetrics, stack) — verify parsing, .catch() resilience, defaults
- [ ] Step 2: Run `npx vitest run src/hexagons/settings/domain/project-settings.schemas.spec.ts`, verify FAIL
- [ ] Step 3: Implement schemas following existing pattern:
  - `BaseToolPoliciesConfigSchema` → `ToolPoliciesConfigSchema = Base.catch(DEFAULTS)`
  - `BaseFailurePoliciesConfigSchema` with `default: FailurePolicyModeSchema, byPhase: Partial<Record<WorkflowPhase, FailurePolicyMode>>`
  - `BaseQualityMetricsConfigSchema` with `perPhaseTracking: z.boolean()`
  - `BaseStackConfigSchema` with `detected: StackInfoSchema, overrides: StackInfoSchema`
  - Add all to `SettingsSchema` with `.default()`
  - Update `SETTINGS_DEFAULTS`
- [ ] Step 4: Run tests, verify PASS
- [ ] Step 5: Write failing tests for VO getters (`toolPolicies`, `workflow`, `qualityMetrics`, `stack`)
- [ ] Step 6: Run `npx vitest run src/hexagons/settings/domain/project-settings.value-object.spec.ts`, verify FAIL
- [ ] Step 7: Add getters to `ProjectSettings` class
- [ ] Step 8: Run tests, verify PASS
- [ ] Step 9: Update barrel exports in `index.ts`
- [ ] Step 10: Commit `feat(settings): add tool-policies, failure-policies, quality-metrics, stack config schemas`

---

## Wave 1 (domain + schema changes — parallel)

### T02: G09 — PreDispatchContext + ToolPolicyRule Refactor
**Files:**
- Modify: `src/hexagons/execution/domain/pre-dispatch.schemas.ts`
- Modify: `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/tool-policy.rule.ts`
- Modify: `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/tool-policy.rule.spec.ts`
**Traces to:** AC1, AC2
**Deps:** T01

- [ ] Step 1: Write failing tests for ToolPolicyRule with `ToolPoliciesConfig` constructor:
  - Test: defaults.blocked accumulates with byRole.blocked
  - Test: allowed list restricts (whitelist)
  - Test: merge chain defaults → byTier → byRole
  - Test: empty config → permissive (no violations)
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/tool-policy.rule.spec.ts`, verify FAIL
- [ ] Step 3: Add `agentRole: z.string().optional()` and `complexityTier: ComplexityTierSchema.optional()` to `PreDispatchContextSchema`
- [ ] Step 4: Refactor `ToolPolicyRule`:
  - Constructor: accept `ToolPoliciesConfig` (from settings schema)
  - `evaluate()`: resolve effective policy via `mergePolicy(config.defaults, config.byTier?.[ctx.complexityTier], config.byRole?.[ctx.agentRole])`
  - Merge logic: blocked lists accumulate (union), allowed lists restrict (intersection); allowed wins at same level
- [ ] Step 5: Run tests, verify PASS
- [ ] Step 6: Commit `feat(execution/G09): refactor ToolPolicyRule for settings-driven config`

### T03: G02 — GuardContext Extension + FailureRecordedEntry
**Files:**
- Modify: `src/hexagons/workflow/domain/workflow-session.schemas.ts`
- Modify: `src/hexagons/execution/domain/journal-entry.schemas.ts`
- Modify: `src/hexagons/execution/domain/journal-entry.schemas.spec.ts` (if exists)
**Traces to:** AC6, AC7, AC8
**Deps:** T01

- [ ] Step 1: Write failing test: `GuardContextSchema.parse()` with `failurePolicy: "lenient"` should succeed
- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/domain/workflow-session.schemas.spec.ts`, verify FAIL
- [ ] Step 3: Add `failurePolicy: FailurePolicyModeSchema.default("strict")` to `GuardContextSchema`. Import `FailurePolicyModeSchema` from `@hexagons/settings`.
- [ ] Step 4: Run test, verify PASS
- [ ] Step 5: Write failing test: `FailureRecordedEntrySchema.parse()` with phase, policy, action fields
- [ ] Step 6: Add `FailureRecordedEntrySchema` to journal-entry.schemas.ts:
  ```typescript
  export const FailureRecordedEntrySchema = JournalEntryBaseSchema.extend({
    type: z.literal("failure-recorded"),
    phase: z.string(),
    policy: z.enum(["strict", "tolerant", "lenient"]),
    action: z.enum(["retried", "continued", "blocked"]),
    error: z.string().optional(),
  });
  ```
- [ ] Step 7: Add to `JournalEntrySchema` discriminated union
- [ ] Step 8: Run tests, verify PASS
- [ ] Step 9: Commit `feat(workflow/G02): add failurePolicy to GuardContext + FailureRecordedEntry schema`

### T04: G03 — TaskMetrics Phase + QualitySnapshotSchema + Port Extensions
**Files:**
- Modify: `src/hexagons/execution/domain/task-metrics.schemas.ts`
- Modify: `src/hexagons/execution/domain/task-metrics.schemas.spec.ts` (if exists)
- Modify: `src/hexagons/execution/domain/ports/metrics-repository.port.ts`
- Modify: `src/hexagons/execution/domain/ports/metrics-query.port.ts`
**Traces to:** AC10, AC11
**Deps:** T01

- [ ] Step 1: Write failing tests:
  - TaskMetricsSchema parses with `phase: "executing"` default
  - TaskMetricsSchema parses with `type: "task-metrics"` default
  - QualitySnapshotSchema parses with all R13 fields (lintErrors, testsPassed, testsFailed, testsSkipped, toolInvocations, toolFailures, reviewScore, filesChanged, linesAdded, linesRemoved)
  - Backward compat: existing entry without phase/type parses correctly
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/task-metrics.schemas.spec.ts`, verify FAIL
- [ ] Step 3: Implement:
  - Add `phase: WorkflowPhaseSchema.default("executing")` to `TaskMetricsSchema`
  - Add `type: z.literal("task-metrics").default("task-metrics")` to `TaskMetricsSchema`
  - Create `QualitySnapshotSchema` with all R13 fields + `type: z.literal("quality-snapshot")`
  - Create `MetricsEntrySchema = z.discriminatedUnion("type", [TaskMetricsSchema, QualitySnapshotSchema])`
- [ ] Step 4: Run tests, verify PASS
- [ ] Step 5: Extend `MetricsRepositoryPort`:
  - `append(entry: TaskMetrics | QualitySnapshot)` — accept union
  - Add `readQualitySnapshots(sliceId: string): Promise<Result<QualitySnapshot[], PersistenceError>>`
- [ ] Step 6: Extend `MetricsQueryPort`:
  - Add `queryByPhase(sliceId, phase)`, `aggregateByPhase(sliceId)`, `getQualitySnapshots(sliceId)`
- [ ] Step 7: Commit `feat(execution/G03): add phase to TaskMetrics, create QualitySnapshotSchema, extend metrics ports`

### T05: G04 — SettingsFilePort.writeFile() + Adapter Implementations
**Files:**
- Modify: `src/hexagons/settings/domain/ports/settings-file.port.ts`
- Modify: `src/hexagons/settings/infrastructure/fs-settings-file.adapter.ts`
- Modify: `src/hexagons/settings/infrastructure/in-memory-settings-file.adapter.ts`
- Modify: `src/hexagons/settings/infrastructure/settings-file.contract.spec.ts`
**Traces to:** AC4, AC12
**Deps:** T01

- [ ] Step 1: Write failing contract test: `writeFile(path, content)` → `readFile(path)` round-trip
- [ ] Step 2: Run `npx vitest run src/hexagons/settings/infrastructure/settings-file.contract.spec.ts`, verify FAIL
- [ ] Step 3: Add `abstract writeFile(path: string, content: string): Promise<Result<void, SettingsFileError>>` to `SettingsFilePort`
- [ ] Step 4: Implement in `FsSettingsFileAdapter` (use `node:fs/promises.writeFile`)
- [ ] Step 5: Implement in `InMemorySettingsFileAdapter` (set in Map)
- [ ] Step 6: Run tests, verify PASS
- [ ] Step 7: Commit `feat(settings/G04): add writeFile to SettingsFilePort + adapters`

---

## Wave 2 (use case + repository implementations — parallel)

### T06: G09 — Extension.ts Wiring + pdContext Population
**Files:**
- Modify: `src/hexagons/execution/application/execute-slice.use-case.ts`
- Modify: `src/cli/extension.ts`
**Traces to:** AC1, AC3
**Deps:** T02

- [ ] Step 1: In `execute-slice.use-case.ts`, add `agentRole` and `complexityTier` to pdContext object (lines ~336-350):
  - `agentRole: config.agentType` (from AgentDispatchConfig)
  - `complexityTier: input.complexityTier` (add to ExecuteSliceInput if not present)
- [ ] Step 2: In `extension.ts`, read settings → extract `toolPolicies` → pass to `ToolPolicyRule` constructor:
  ```typescript
  new ToolPolicyRule(settings.toolPolicies)
  ```
- [ ] Step 3: Run `npx vitest run src/hexagons/execution/application/execute-slice.use-case.spec.ts`, verify PASS
- [ ] Step 4: Commit `feat(execution/G09): wire tool policies from settings to pre-dispatch`

### T07: G02 — OrchestratePhaseTransitionUseCase Failure Routing
**Files:**
- Modify: `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.ts`
- Modify: `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.spec.ts`
**Traces to:** AC6, AC7, AC8
**Deps:** T03

- [ ] Step 1: Write failing tests:
  - Test: strict mode + failure → triggers "fail" → blocked (existing behavior)
  - Test: tolerant mode + failure → records FailureRecordedEntry + triggers "fail"
  - Test: lenient mode + non-critical failure → records FailureRecordedEntry + triggers success path (phase advances)
  - Test: lenient mode + critical failure → still triggers "fail"
- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.spec.ts`, verify FAIL
- [ ] Step 3: Implement failure routing in `execute()`:
  - Read failure policy from `input.guardContext.failurePolicy` (populated by infra layer in T10; no new settingsPort dependency — preserves domain ← app ← infra direction)
  - Define `PHASE_SUCCESS_TRIGGERS` map: `{ discussing: "next", researching: "next", planning: "approve", executing: "next", verifying: "approve", reviewing: "approve", shipping: "next" }`
  - On trigger result error:
    - Read policy: `input.guardContext.failurePolicy` (defaults to "strict" via schema)
    - strict: existing behavior (`session.trigger("fail", ...)`)
    - tolerant: record `FailureRecordedEntry(action: "retried")` → `session.trigger("fail", ...)`
    - lenient (non-critical): record `FailureRecordedEntry(action: "continued")` → `session.trigger(PHASE_SUCCESS_TRIGGERS[phase], ...)`
- [ ] Step 4: Run tests, verify PASS
- [ ] Step 5: Commit `feat(workflow/G02): implement failure policy routing in phase transition orchestrator`

### T08: G03 — Metrics Repository Implementations (Discriminated Union)
**Files:**
- Modify: `src/hexagons/execution/infrastructure/repositories/metrics/jsonl-metrics.repository.ts`
- Modify: `src/hexagons/execution/infrastructure/repositories/metrics/in-memory-metrics.repository.ts`
- Modify: `src/hexagons/execution/infrastructure/repositories/metrics/metrics-repository.contract.spec.ts`
**Traces to:** AC10, AC11
**Deps:** T04

- [ ] Step 1: Write failing contract tests:
  - Test: quality snapshot round-trip (append → readQualitySnapshots)
  - Test: type discrimination (TaskMetrics and QualitySnapshot stored separately)
  - Test: backward compat (entries without type field parse as task-metrics)
  - Test: phase filtering via readBySlice still returns only TaskMetrics
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/infrastructure/repositories/metrics/metrics-repository.contract.spec.ts`, verify FAIL
- [ ] Step 3: Implement `JsonlMetricsRepository`:
  - `serializeEntry()`: ensure `type` field present
  - `readAll()`: parse with type discriminator — check `type` field, route to `TaskMetricsSchema` or `QualitySnapshotSchema`; entries without `type` → default to task-metrics
  - `readQualitySnapshots(sliceId)`: readAll → filter type="quality-snapshot" + sliceId match
  - `readBySlice/readByMilestone`: filter type="task-metrics" only
- [ ] Step 4: Implement `InMemoryMetricsRepository`:
  - Change store to `(TaskMetrics | QualitySnapshot)[]`
  - Add `readQualitySnapshots()` method
  - Filter by type in existing read methods
- [ ] Step 5: Run tests, verify PASS
- [ ] Step 6: Commit `feat(execution/G03): implement discriminated union in metrics repositories`

### T09: G04 — DiscoverStackUseCase Implementation
**Files:**
- Create: `src/hexagons/settings/use-cases/discover-stack.use-case.ts`
- Create: `src/hexagons/settings/use-cases/discover-stack.use-case.spec.ts`
- Modify: `src/hexagons/settings/index.ts`
**Traces to:** AC4, AC5
**Deps:** T05

- [ ] Step 1: Write failing tests:
  - Test: detects Node/TS project from package.json + tsconfig.json → `{ runtime: "typescript" }`
  - Test: detects pnpm from pnpm-lock.yaml → `{ packageManager: "pnpm" }`
  - Test: detects vitest from vitest.config.ts → `{ testRunner: "vitest" }`
  - Test: detects biome from biome.json → `{ linter: "biome" }`
  - Test: detects React framework from package.json dependencies → `{ framework: "react" }`
  - Test: returns empty StackInfo for empty directory
  - Test: overrides not clobbered — effective = `{ ...detected, ...overrides }`
- [ ] Step 2: Run `npx vitest run src/hexagons/settings/use-cases/discover-stack.use-case.spec.ts`, verify FAIL
- [ ] Step 3: Implement `DiscoverStackUseCase`:
  - Constructor: `settingsFilePort: SettingsFilePort` (reuse existing readFile for package.json etc.)
  - `execute(projectRoot)`:
    1. `readFile("package.json")` → parse JSON → extract deps → detect framework + runtime
    2. Check lock files via `readFile()` (null = not found): pnpm-lock.yaml, package-lock.json, yarn.lock
    3. Check config files: vitest.config.ts/js, jest.config.ts/js, biome.json, .eslintrc*
    4. Check tsconfig.json existence
    5. Return `StackInfo`
- [ ] Step 4: Run tests, verify PASS
- [ ] Step 5: Export from `settings/index.ts`
- [ ] Step 6: Commit `feat(settings/G04): implement DiscoverStackUseCase`

---

## Wave 3 (integration + wiring — parallel)

### T10: G02 — Guard Context Wiring in PI Tools
**Files:**
- Modify: `src/hexagons/workflow/infrastructure/pi/workflow-transition.tool.ts`
- Modify: `src/hexagons/workflow/use-cases/quick-start.use-case.ts`
**Traces to:** AC6, AC9
**Deps:** T07

- [ ] Step 1: In `workflow-transition.tool.ts`: read failure policy from settings → include `failurePolicy` in guard context built at lines ~48-59
- [ ] Step 2: In `quick-start.use-case.ts`: include `failurePolicy: "strict"` in hardcoded guard contexts
- [ ] Step 3: Run `npx vitest run src/hexagons/workflow/infrastructure/pi/workflow-transition.tool.spec.ts`, verify PASS
- [ ] Step 4: Commit `feat(workflow/G02): wire failurePolicy into guard context builders`

### T11: G03 — RecordTaskMetrics Phase + AggregateMetrics + Quality Capture
**Files:**
- Modify: `src/hexagons/execution/application/record-task-metrics.use-case.ts`
- Modify: `src/hexagons/execution/application/record-task-metrics.use-case.spec.ts` (if exists)
- Modify: `src/hexagons/execution/application/aggregate-metrics.use-case.ts`
- Modify: `src/hexagons/execution/application/aggregate-metrics.use-case.spec.ts` (if exists)
- Modify: `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.ts`
**Traces to:** AC10, AC11
**Deps:** T07, T08

- [ ] Step 1: Write failing test: `RecordTaskMetricsUseCase` records TaskMetrics with `phase` field set
- [ ] Step 2: Inject phase resolver into `RecordTaskMetricsUseCase` constructor (e.g., `currentPhase: () => WorkflowPhase`)
- [ ] Step 3: Add `phase` to TaskMetrics construction in `onTaskExecutionCompleted()`
- [ ] Step 4: Run test, verify PASS
- [ ] Step 5: Write failing test: `AggregateMetricsUseCase.aggregateByPhase(sliceId)` returns per-phase breakdown
- [ ] Step 6: Implement `aggregateByPhase()`: read metrics by slice → group by phase → aggregate each group
- [ ] Step 7: Run test, verify PASS
- [ ] Step 8: Add quality snapshot capture to `OrchestratePhaseTransitionUseCase`:
  - Add `metricsRepo: MetricsRepositoryPort` dependency (new workflow→execution coupling — pragmatic choice per spec; alternative would be event-driven but adds complexity)
  - Check `settings.qualityMetrics.perPhaseTracking` from guard context or injected config
  - If enabled: before transition, build QualitySnapshot from turn metrics + git diff stats
  - Call `metricsRepo.append(snapshot)`
- [ ] Step 9: Commit `feat(execution/G03): inject phase into metrics recording + quality snapshot capture at transitions`

### T12: G04 — InitProjectUseCase Integration + CLI Wiring
**Files:**
- Modify: `src/hexagons/project/use-cases/init-project.use-case.ts`
- Modify: `src/hexagons/project/use-cases/init-project.use-case.spec.ts`
- Modify: `src/hexagons/project/infrastructure/pi/project.extension.ts`
- Modify: `src/cli/extension.ts`
**Traces to:** AC4, AC5, AC12
**Deps:** T09

- [ ] Step 1: Write failing test: `InitProjectUseCase` calls `DiscoverStackUseCase` and writes detected stack to settings.yaml
- [ ] Step 2: Run `npx vitest run src/hexagons/project/use-cases/init-project.use-case.spec.ts`, verify FAIL
- [ ] Step 3: Add `discoverStack: DiscoverStackUseCase` to `InitProjectUseCase` constructor deps
- [ ] Step 4: After creating .tff/ and before writing settings.yaml:
  ```typescript
  const stackResult = await this.discoverStack.execute(params.projectRoot);
  if (isOk(stackResult)) {
    // Merge detected stack into settings before serialization
    settingsJson.stack = { detected: stackResult.data, overrides: {} };
  }
  ```
- [ ] Step 5: Run test, verify PASS
- [ ] Step 6: Wire in `project.extension.ts` and `extension.ts`: create `DiscoverStackUseCase` with `settingsFilePort`, inject into `InitProjectUseCase`
- [ ] Step 7: Commit `feat(project/G04): integrate stack discovery into project init`

---

## Wave 4 (final verification)

### T13: Cross-Feature Integration Tests
**Files:**
- Modify: various spec files (run full test suite)
**Traces to:** AC1-AC12 (all)
**Deps:** T06, T10, T11, T12

- [ ] Step 1: Run full test suite: `npx vitest run`
- [ ] Step 2: Fix any failures from cross-feature interactions
- [ ] Step 3: Verify barrel exports: all new schemas, types, use cases exported from hexagon index.ts files
- [ ] Step 4: Run `npx vitest run` again, verify all PASS
- [ ] Step 5: Commit `chore(M07-S10): final integration verification`

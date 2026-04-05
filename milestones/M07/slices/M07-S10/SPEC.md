# Spec — M07-S10: Gap Features (G09, G04, G02, G03)

## Problem

Four gap-analysis features remain unimplemented: configurable tool policies per agent (G09), stack auto-discovery (G04), per-phase failure policies (G02), and per-stage quality metrics (G03). Without these, the platform lacks runtime safety controls for agent tools, cannot auto-detect project stack, has no nuanced failure handling, and cannot track quality across workflow phases.

## Approach

Settings-first, then feature-parallel. All 4 features extend `ProjectSettingsSchema` with new config sections (single coherent schema change), then implement independently. Features share the settings hexagon as integration point but are otherwise decoupled.

## Design

### Settings Schema Extensions

All features add sections to `settings.yaml` via `ProjectSettingsSchema`:

```yaml
# G09
tool-policies:
  defaults:
    blocked: []
  by-tier:
    S:
      blocked: [Agent]
  by-role:
    security-auditor:
      allowed: [Read, Grep, Glob, Bash]
    executor:
      blocked: []

# G02
workflow:
  failure-policies:
    default: strict
    by-phase:
      researching: tolerant
      executing: strict
      verifying: strict
      reviewing: tolerant
      shipping: strict

# G03
quality-metrics:
  per-phase-tracking: true

# G04
stack:
  detected: {}
  overrides: {}
```

∀ new section: Zod `.default()` for backward compat — existing `settings.yaml` files parse without changes.

### G09: Configurable Tool/Command Rules Per Agent

**Schemas** (settings domain):
- `ToolPolicyEntrySchema` = `{ allowed?: string[], blocked?: string[] }`
- `ToolPoliciesConfigSchema` = `{ defaults: ToolPolicyEntrySchema, byTier: Record<ComplexityTier, ToolPolicyEntrySchema>, byRole: Record<string, ToolPolicyEntrySchema> }`

**Resolution**: `merge(defaults, byTier[tier], byRole[role])` — blocked lists accumulate across levels, allowed lists restrict. If both `allowed` and `blocked` are set at the same level, `allowed` wins (whitelist takes precedence).

**PreDispatchContext enrichment**:
- Add `agentRole: string` and `complexityTier: ComplexityTier` to `PreDispatchContextSchema`
- Populated by `ExecuteSliceUseCase` when building dispatch context

**ToolPolicyRule refactor**:
- Constructor accepts `ToolPoliciesConfig` (from settings) instead of empty Map
- `evaluate()` resolves effective policy via merge chain → returns blocker violations for disallowed tools
- Wired in `extension.ts` via settings read → rule construction → `ComposablePreDispatchAdapter`

### G04: Stack Auto-Discovery

**Schemas** (settings domain):
- `StackInfoSchema` = `{ runtime?, framework?, packageManager?, buildTool?, testRunner?, linter? }` (∀ fields optional strings)
- `StackConfigSchema` = `{ detected: StackInfoSchema, overrides: StackInfoSchema }`
- Effective stack = `{ ...detected, ...overrides }` — overrides win

**DiscoverStackUseCase** (settings hexagon):
- Input: project root path
- Detection targets (Node/TS primary):
  - `package.json` → extract `dependencies`/`devDependencies` for framework hints (react, next, express, etc.)
  - Lock file type → package manager (`pnpm-lock.yaml` → pnpm, `package-lock.json` → npm, `yarn.lock` → yarn)
  - `tsconfig.json` → TypeScript runtime
  - `vitest.config.*` / `jest.config.*` → test runner
  - `biome.json` / `.eslintrc*` → linter
- Returns `StackInfo`

**Integration**:
- `InitProjectUseCase` (project hexagon) → calls `DiscoverStackUseCase` (settings hexagon) after creating `.tff/`, merges discovered stack into settings props before serialization. Cross-hexagon dependency is precedented (`InitProjectUseCase` already depends on `MergeSettingsUseCase`).
- `/tff:settings` → re-runs discovery on demand
- `stack.overrides` never clobbered by discovery

### G02: Failure Policy Model

**Schemas** (workflow domain):
- `FailurePolicyMode` = `z.enum(["strict", "tolerant", "lenient"])`
- `FailurePoliciesConfigSchema` = `{ default: FailurePolicyMode, byPhase: Partial<Record<WorkflowPhase, FailurePolicyMode>> }`

**Semantics**:
- **strict**: fail → retry (up to `maxRetries`) → blocked. Current behavior.
- **tolerant**: fail → record in journal → retry (up to `maxRetries`) → blocked. Same retry logic as strict; journal records failure details for audit. Warnings ¬block.
- **lenient**: fail → record in journal → continue to next phase. Only critical/unrecoverable errors block. Non-critical failures logged but ¬prevent transition.

**Guard extension**:
- Add `failurePolicy: FailurePolicyMode` to `GuardContextSchema`
- `retriesExhausted` guard respects policy: strict/tolerant → block, lenient → allow continue

**Routing (use-case level, not transition table)**:
- Failure policy routing lives in `OrchestratePhaseTransitionUseCase`, ¬in the transition table
- Reason: no universal "advance" trigger exists — different phases use different triggers (`next` from executing, `approve` from reviewing, etc.). Use-case approach handles this polymorphism.
- Flow: read failure policy from settings for current phase → on failure:
  - **strict/tolerant**: call `session.trigger("fail")` → existing `fail → blocked` transition (after retries). Tolerant additionally records `FailureRecordedEntry` before triggering.
  - **lenient**: use case does NOT call `session.trigger("fail")`. Instead: (1) record `FailureRecordedEntry` in journal with `action: "continued"`, (2) call the normal success trigger for the current phase (phase-to-trigger mapping in use case: executing→`next`, verifying→`next`, reviewing→`approve`, etc.). Only critical/unrecoverable errors (e.g., aggregate invariant violations) fall through to `fail`.
- Phase-to-success-trigger mapping: hardcoded in use case, mirrors transition table. ∀ new phase added to transition table → mapping must be updated (enforced by exhaustive switch).

**Note on MetricsRepositoryPort (G03)**:
- `MetricsRepositoryPort.append()` currently typed for `TaskMetrics` only
- Must extend port interface to accept `TaskMetrics | QualitySnapshot` (discriminated union via `type` field)
- Contract tests + all adapters (in-memory, jsonl) updated accordingly
- Existing `metrics.jsonl` entries lack `type` field → `TaskMetricsSchema` gets `type: z.literal("task-metrics").default("task-metrics")` for backward compat

**Journal**:
- New entry: `FailureRecordedEntry` = `{ phase, error, policy, action: "retried" | "continued" | "blocked" }`

### G03: Per-Stage Quality Metrics

**QualitySnapshotSchema** (execution domain):
```
QualitySnapshotSchema = z.object({
  phase: WorkflowPhaseSchema,
  sliceId: z.string(),
  milestoneId: z.string(),
  capturedAt: z.string().datetime(),
  lintErrors: z.number().default(0),
  testsPassed: z.number().default(0),
  testsFailed: z.number().default(0),
  testsSkipped: z.number().default(0),
  toolInvocations: z.number().default(0),
  toolFailures: z.number().default(0),
  reviewScore: z.number().nullable().default(null),
  filesChanged: z.number().default(0),
  linesAdded: z.number().default(0),
  linesRemoved: z.number().default(0),
})
```

**TaskMetrics extension**:
- Add `phase: WorkflowPhase` to `TaskMetricsSchema` (`.default("executing")` for backward compat)
- `RecordTaskMetricsUseCase` receives phase from caller

**MetricsQueryPort extension**:
- `queryByPhase(sliceId, phase): Promise<TaskMetrics[]>`
- `aggregateByPhase(sliceId): Promise<Record<WorkflowPhase, AggregatedMetrics>>`
- `recordQualitySnapshot(snapshot): Promise<void>`
- `getQualitySnapshots(sliceId): Promise<QualitySnapshot[]>`

**Capture**:
- `OrchestratePhaseTransitionUseCase` captures snapshot at phase boundaries (before transition)
- Populated from: turn metrics (tool counts), journal (task success/failure counts), git diff (files/lines changed)
- Lint/test fields default to 0 when not captured (¬hard dependency on external tool output parsing)

**Storage**:
- `metrics.jsonl` with `type` field discriminator: `"task-metrics"` | `"quality-snapshot"`
- `JsonlMetricsRepository` extended with quality snapshot record type + type-filtered queries
- `quality-metrics.per-phase-tracking: true` enables capture; disabled = no snapshots (backward compat)

## Non-Goals

- Non-Node/TS stack detection (G04 targets Node/TS per AC)
- Real-time lint/test output parsing (G03 fields default to 0; future M08 work)
- Per-slice failure policy overrides (G02 is settings-level only)
- Phase-aware tool policies (G09 is role+tier, ¬phase)
- Quality SLOs / threshold alerting (future)

## Acceptance Criteria

| ID | Criterion | Feature |
|---|---|---|
| AC1 | Tool policies enforced before dispatch — ToolPolicyRule blocks disallowed tools | G09 |
| AC2 | Per-tier and per-role rules composable via merge resolution | G09 |
| AC3 | Tool policies configurable in `settings.yaml` under `tool-policies` | G09 |
| AC4 | Stack detected automatically for Node/TS projects (package.json + tsconfig + lock file) | G04 |
| AC5 | Manual stack overrides in `stack.overrides` not clobbered by discovery | G04 |
| AC6 | Failure policy respected at phase transitions via guard context | G02 |
| AC7 | Tolerant mode records failures in journal without blocking (until retries exhausted) | G02 |
| AC8 | Lenient mode allows phase transition despite non-critical failure (records + continues) | G02 |
| AC9 | Failure policies configurable in `settings.yaml` under `workflow.failure-policies` | G02 |
| AC10 | Quality signals captured per stage via QualitySnapshot at phase boundaries | G03 |
| AC11 | Trends queryable by milestone/slice via MetricsQueryPort phase methods | G03 |
| AC12 | `tff init` triggers stack discovery and populates `stack.detected` in settings | G04 |

# Research — M07-S11: Production Wiring Completeness

## 1. Composition Root Inventory (extension.ts)

### InMemory* Adapters to Replace

| Adapter | Line | Replacement | Status |
|---------|------|-------------|--------|
| `InMemoryJournalRepository` | L176 | `JsonlJournalRepository` | Implementation exists |
| `InMemoryCheckpointRepository` | L177 | `MarkdownCheckpointRepository` | Implementation exists |
| `InMemoryWorkflowSessionRepository` | L162 | `SqliteWorkflowSessionRepository` | Must create |
| `InMemoryReviewRepository` | L200 | `SqliteReviewRepository` | Stub exists, must implement |
| `InMemoryVerificationRepository` | L276 | `SqliteVerificationRepository` | Stub exists, must implement |
| `InMemoryReviewUIAdapter` | L283 | Reuse existing `reviewUI` variable (L166-168) | Already wired |
| `InMemoryAgentEventHub` | L118 | **Keep** (intentional in-process pub/sub) | N/A |

### NoOp* Adapters to Replace

| Adapter | Line | Replacement |
|---------|------|-------------|
| `NoOpContextStaging` (class definition L103-107, used L445) | `DefaultContextStagingAdapter` + `SettingsModelProfileResolver` |

### AlwaysUnder* Stubs

| Stub | Line | Action |
|------|------|--------|
| `AlwaysUnderBudgetAdapter` | L491 | **Keep** (deferred to cost tracking milestone) |

### Stubs to Replace

| Stub | Lines | Replacement |
|------|-------|-------------|
| `executeSliceStub` | L184-186 | Real `ExecuteSliceUseCase` with 19 deps |
| `CachedExecutorQueryAdapter` (empty set) | L201-204 | Real query via `GetSliceExecutorsUseCase` |

## 2. Dependency Graph for ExecuteSliceUseCase (19 deps)

Source: `src/hexagons/execution/application/execute-slice.use-case.ts` (L63-83)

| # | Dep | Type | Source in extension.ts |
|---|-----|------|------------------------|
| 1 | `taskRepository` | `TaskRepositoryPort` | `taskRepo` (L155, existing SQLite) |
| 2 | `waveDetection` | `WaveDetectionPort` | `new DetectWavesUseCase()` (L441, existing) |
| 3 | `checkpointRepository` | `CheckpointRepositoryPort` | `MarkdownCheckpointRepository` (Wave 1.2) |
| 4 | `agentDispatch` | `AgentDispatchPort` | `sharedAgentDispatch` (L119, existing) |
| 5 | `worktree` | `WorktreePort` | `worktreeAdapter` (L140, existing) |
| 6 | `eventBus` | `EventBusPort` | `eventBus` (L116, existing) |
| 7 | `journalRepository` | `JournalRepositoryPort` | `JsonlJournalRepository` (Wave 1.1) |
| 8 | `metricsRepository` | `MetricsRepositoryPort` | `new JsonlMetricsRepository(metricsPath)` — **new instantiation** |
| 9 | `dateProvider` | `DateProviderPort` | `dateProvider` (L117, existing) |
| 10 | `logger` | `LoggerPort` | `logger` (L115, existing) |
| 11 | `templateContent` | `string` | `readFileSync("src/resources/protocols/execute.md", "utf-8")` — file exists |
| 12 | `guardrail` | `OutputGuardrailPort` | `new ComposableGuardrailAdapter(rules, overrides, gitPort)` — **new wiring** |
| 13 | `gitPort` | `GitPort` | `gitPort` (L135, existing) |
| 14 | `overseer` | `OverseerPort` | `new ComposableOverseerAdapter(strategies)` — **new wiring** |
| 15 | `retryPolicy` | `RetryPolicy` | `new DefaultRetryPolicy(maxRetries, threshold)` — **new wiring** |
| 16 | `overseerConfig` | `OverseerConfig` | `OverseerConfigSchema.parse({})` — defaults suffice |
| 17 | `preDispatchGuardrail` | `PreDispatchGuardrailPort` | `new ComposablePreDispatchAdapter(rules)` — **new wiring** |
| 18 | `modelResolver` | `(profileName: string) => { provider, modelId }` | Existing pattern at L210-213 |
| 19 | `checkpointBeforeRetry` | `boolean` | `true` |

### Sub-dependencies for New Wiring

**GuardrailRules** (5 rules exist):
- `DangerousCommandRule`, `CredentialExposureRule`, `DestructiveGitRule` (severity: error)
- `FileScopeRule`, `SuspiciousContentRule` (severity: warning)
- Source: `src/hexagons/execution/infrastructure/adapters/guardrails/rules/`

**PreDispatchGuardrailRules** (5 rules exist):
- `ScopeContainmentRule`, `DependencyCheckRule`, `ToolPolicyRule`, `WorktreeStateRule`, `BudgetCheckRule`
- Source: `src/hexagons/execution/infrastructure/adapters/pre-dispatch/rules/`

**OverseerStrategies** (1 exists):
- `TimeoutStrategy` — constructor: `new TimeoutStrategy(overseerConfig)`
- Source: `src/hexagons/execution/infrastructure/policies/timeout-strategy.ts`

**DefaultRetryPolicy** constructor: `(maxRetries: number, retryLoopThreshold: number, downshiftChain?: string[], retryCountPerProfile?: number)` — Source from settings.yaml `autonomy.max-retries`.

**JsonlMetricsRepository** constructor: `(filePath: string)` — path: `${tffDir}/metrics.jsonl`. Source: `src/hexagons/execution/infrastructure/repositories/metrics/jsonl-metrics.repository.ts`

## 3. Port Interface Changes Required

### WorkflowSessionRepositoryPort
- File: `src/hexagons/workflow/domain/ports/workflow-session.repository.port.ts`
- Current methods: `save`, `findById`, `findByMilestoneId`
- **Add:** `abstract reset(): void`, `abstract findAll(): Promise<Result<WorkflowSession[], PersistenceError>>`
- In-memory impl already has `reset()` (L45-47) and `seed()` — add `findAll()`

### ReviewRepositoryPort
- File: `src/hexagons/review/domain/ports/review-repository.port.ts`
- Current methods: `save`, `findById`, `findBySliceId`, `delete`
- **Add:** `abstract reset(): void`, `abstract findAll(): Promise<Result<Review[], PersistenceError>>`
- In-memory impl already has `reset()` (L39-41) — add `findAll()`

### VerificationRepositoryPort
- File: `src/hexagons/review/domain/ports/verification-repository.port.ts`
- Current methods: `save`, `findBySliceId`
- **Add:** `abstract reset(): void`, `abstract findAll(): Promise<Result<Verification[], PersistenceError>>`
- In-memory impl already has `reset()` (L28-30) — add `findAll()`

### Pattern Reference
- `ShipRecordRepositoryPort` at `src/hexagons/review/domain/ports/ship-record-repository.port.ts` has both `findAll()` (L7) and `reset()` (L8) — use as template.

## 4. SQLite Repository Patterns

### Reference: SqliteSliceRepository
- File: `src/hexagons/slice/infrastructure/sqlite-slice.repository.ts`
- Constructor creates table via `this.db.exec(CREATE TABLE IF NOT EXISTS ...)`
- `save()` = INSERT OR REPLACE
- `findBy*()` = SELECT + reconstitute via `Aggregate.reconstitute(props)`
- `reset()` = `DELETE FROM table_name`
- JSON columns: `JSON.stringify()` on write, `JSON.parse()` on read

### Contract Test Pattern
- File: `src/hexagons/slice/infrastructure/slice-repository.contract.spec.ts`
- Factory fn accepts repo with `reset()` → runs shared test suite against both InMemory + SQLite

### Table Schemas (from SPEC)

**workflow_sessions:** id, milestone_id, slice_id, current_phase, previous_phase, retry_count, autonomy_mode, created_at, updated_at, last_escalation (JSON)

**reviews:** id, slice_id, role, agent_identity, verdict, findings (JSON array of FindingProps), created_at, updated_at

**verifications:** id, slice_id, agent_identity, criteria (JSON array of CriterionVerdictProps), overall_verdict, fix_cycle_index, created_at

### Props Schemas for StateSnapshot

All three entity props schemas exist and are well-defined:
- `WorkflowSessionPropsSchema` — `src/hexagons/workflow/domain/workflow-session.schemas.ts` (L50-62)
- `ReviewPropsSchema` — `src/hexagons/review/domain/schemas/review.schemas.ts` (L40-50)
- `VerificationPropsSchema` — `src/hexagons/review/domain/schemas/verification.schemas.ts` (L14-23)

## 5. StateSnapshot Extension

### Current Schema
- File: `src/kernel/infrastructure/state-branch/state-snapshot.schemas.ts`
- Version: 1 (L10)
- Fields: project, milestones, slices, tasks, shipRecords, completionRecords
- Migration system exists (L29-54) but no migrations defined yet

### v2 Changes
- Bump `SCHEMA_VERSION` to 2
- Add: `workflowSessions`, `reviews`, `verifications` with `.default([])`
- Add migration `1 → 2`: identity function (defaults handle missing fields)

### StateExporter / StateImporter
- Exporter: `src/kernel/services/state-exporter.ts` (deps interface L14-21)
- Importer: `src/kernel/services/state-importer.ts` (deps interface L21-28)
- Both share parallel `Deps` interface — add 3 new repo deps to each
- Exporter calls `repo.findAll()` → maps to `.toJSON()`
- Importer calls `repo.reset()` → `Aggregate.reconstitute()` → `repo.save()`

## 6. Phase Command Analysis

### Current Handler Shape
All phase commands (discuss, research, plan) follow identical pattern:
```typescript
handler: async (args: string) => {
  await deps.withGuard?.();
  // ... process ...
}
```

The `_ctx: ExtensionCommandContext` parameter is available (PI SDK provides it as 2nd arg) but **not declared** in handler signatures. The `tff:status` command shows the pattern: `handler: async (_args, _ctx) => { ... }`.

### Fresh Context (AC13)
- `newSession()` is NOT found in codebase — spec references PI SDK ≥ 0.64.0
- **Risk:** Must verify `ExtensionCommandContext.newSession()` API exists at implementation time
- **Fallback:** Spec suggests `api.sendMessage(protocol, { triggerTurn: true, deliverAs: "nextTurn" })` as alternative
- node_modules not present in working dir — cannot verify SDK typings. Must `npm install` first.

### Files to Modify
- `src/hexagons/workflow/infrastructure/pi/discuss.command.ts` (handler at L20)
- `src/hexagons/workflow/infrastructure/pi/research.command.ts` (handler at L23)
- `src/hexagons/workflow/infrastructure/pi/plan.command.ts` (handler at L22)

## 7. Workflow Journal

### New Artifacts to Create
1. **Port:** `src/hexagons/workflow/domain/ports/workflow-journal.port.ts`
   - Schema: `WorkflowJournalEntrySchema` (type, sessionId, milestoneId, sliceId?, fromPhase?, toPhase?, trigger?, timestamp, metadata?)
   - Methods: `append(entry)`, `readAll()`

2. **Adapter:** `src/hexagons/workflow/infrastructure/jsonl-workflow-journal.repository.ts`
   - Mirror `JsonlJournalRepository` pattern from execution hexagon
   - Constructor: `(filePath: string)` — path: `${tffDir}/workflow-journal.jsonl`

3. **Use Case:** `src/hexagons/workflow/application/replay-workflow-journal.use-case.ts`
   - Deps: `WorkflowJournalPort`, `WorkflowSessionRepositoryPort`
   - Groups entries by sessionId, replays phase transitions, saves to repo

### OrchestratePhaseTransitionUseCase Integration
- File: `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.ts`
- Current deps (L41-46): sessionRepo, sliceTransitionPort, eventBus, dateProvider
- **Add:** `workflowJournal: WorkflowJournalPort` as 5th dep
- Insert journal append after session save (L93) / before event publish (L96)

## 8. InMemoryContextStagingAdapter Rename

- Source: `src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.ts`
- Spec: `src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.spec.ts`
- Target: `default-context-staging.adapter.ts` / `default-context-staging.adapter.spec.ts`
- Class rename: `InMemoryContextStagingAdapter` → `DefaultContextStagingAdapter`
- Barrel: `src/hexagons/workflow/index.ts`
- Constructor takes: `{ modelProfileResolver: ModelProfileResolverPort }`
- No implementation exists for `ModelProfileResolverPort` — `SettingsModelProfileResolver` is the first

## 9. TurnMetrics Persistence

### Current State
- `TurnMetrics` captured in `PiAgentDispatchAdapter` → returned in `AgentResult.turns`
- `TaskMetricsSchema` at `src/hexagons/execution/domain/task-metrics.schemas.ts` has 13 fields, **no `turns` field**
- `RecordTaskMetricsUseCase` subscribes to `TASK_EXECUTION_COMPLETED` events

### Change
- Add `turns: z.array(TurnMetricsSchema).optional().default([])` to `TaskMetricsSchema`
- `RecordTaskMetricsUseCase` already populates from event payload — add `turns` field from `AgentResult`
- `TurnMetricsSchema` defined at `src/kernel/agents/schemas/turn-metrics.schema.ts` (turnIndex, toolCalls, durationMs)

## 10. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `ctx.newSession()` API shape unknown (no node_modules) | Medium | Install deps first; fallback in SPEC |
| 19-dep wiring for ExecuteSliceUseCase | Low | All deps identified, constructors documented |
| SQLite schema migration (v1 → v2) | Low | `.default([])` handles missing fields |
| GuardrailRule constructors may need settings | Low | Check each rule's constructor at implementation |
| Barrel re-exports for new types | Low | Follow existing patterns in hexagon index.ts files |

## 11. Implementation Order Recommendation

1. **Port interface changes** (3 files) — unblocks SQLite repos + state snapshot
2. **Wave 1: Pure swaps** (Journal, Checkpoint, ReviewUI) — immediate value, zero new code
3. **Wave 2a: SQLite repos** (WorkflowSession, Review, Verification) + contract tests
4. **Wave 2b: SettingsModelProfileResolver** + DefaultContextStagingAdapter rename
5. **Wave 2c: WorkflowJournalPort** + JsonlWorkflowJournalRepository + ReplayUseCase
6. **Wave 3a: StateSnapshot v2** + Exporter/Importer extension
7. **Wave 3b: ExecuteSliceUseCase full wiring** (19 deps)
8. **Wave 3c: CachedExecutorQueryAdapter** real query
9. **Wave 3d: TurnMetrics persistence**
10. **Wave 3e: OrchestratePhaseTransitionUseCase** journal write-through
11. **Wave 3f: Fresh context per phase** (ctx.newSession() in commands)
12. **Verification:** All ACs, zero regressions

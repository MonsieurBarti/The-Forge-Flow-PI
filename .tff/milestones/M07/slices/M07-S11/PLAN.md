# M07-S11: Production Wiring Completeness — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Replace all in-memory/stub adapters in the composition root (`extension.ts`) with production-ready persistent implementations. Zero `InMemory*` (except `InMemoryAgentEventHub`), zero `NoOp*`, zero unreachable stubs.

**Architecture:** Hexagonal — ports stay unchanged (only extended with `reset()`/`findAll()`); new SQLite adapters implement existing ports; composition root rewired.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Zod, JSONL persistence

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/hexagons/workflow/infrastructure/sqlite-workflow-session.repository.ts` | SQLite impl of WorkflowSessionRepositoryPort |
| `src/hexagons/workflow/infrastructure/sqlite-workflow-session.repository.spec.ts` | Contract tests |
| `src/hexagons/workflow/infrastructure/settings-model-profile-resolver.ts` | ModelProfileResolverPort impl using MergeSettingsUseCase |
| `src/hexagons/workflow/infrastructure/settings-model-profile-resolver.spec.ts` | Unit tests |
| `src/hexagons/workflow/domain/ports/workflow-journal.port.ts` | WorkflowJournalPort + entry schema |
| `src/hexagons/workflow/infrastructure/jsonl-workflow-journal.repository.ts` | JSONL impl of WorkflowJournalPort |
| `src/hexagons/workflow/infrastructure/jsonl-workflow-journal.repository.spec.ts` | Tests |
| `src/hexagons/workflow/application/replay-workflow-journal.use-case.ts` | Reconstruct sessions from journal |
| `src/hexagons/workflow/application/replay-workflow-journal.use-case.spec.ts` | Tests |

### Renamed Files
| From | To |
|------|-----|
| `src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.ts` | `src/hexagons/workflow/infrastructure/default-context-staging.adapter.ts` |
| `src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.spec.ts` | `src/hexagons/workflow/infrastructure/default-context-staging.adapter.spec.ts` |

### Modified Files
| File | Change |
|------|--------|
| `src/hexagons/workflow/domain/ports/workflow-session.repository.port.ts` | Add `reset()`, `findAll()` |
| `src/hexagons/review/domain/ports/review-repository.port.ts` | Add `reset()`, `findAll()` |
| `src/hexagons/review/domain/ports/verification-repository.port.ts` | Add `reset()`, `findAll()` |
| `src/hexagons/workflow/infrastructure/in-memory-workflow-session.repository.ts` | Add `findAll()` |
| `src/hexagons/review/infrastructure/repositories/review/in-memory-review.repository.ts` | Add `findAll()` |
| `src/hexagons/review/infrastructure/repositories/verification/in-memory-verification.repository.ts` | Add `findAll()` |
| `src/hexagons/review/infrastructure/repositories/review/sqlite-review.repository.ts` | Full implementation |
| `src/hexagons/review/infrastructure/repositories/verification/sqlite-verification.repository.ts` | Full implementation |
| `src/kernel/infrastructure/state-branch/state-snapshot.schemas.ts` | v2 schema + migration |
| `src/kernel/services/state-exporter.ts` | 3 new repo deps |
| `src/kernel/services/state-importer.ts` | 3 new repo deps |
| `src/hexagons/execution/domain/task-metrics.schemas.ts` | Add `turns` field |
| `src/hexagons/execution/application/record-task-metrics.use-case.ts` | Persist turns |
| `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.ts` | Inject WorkflowJournalPort |
| `src/hexagons/workflow/infrastructure/pi/discuss.command.ts` | Accept `ctx`, call `newSession()` |
| `src/hexagons/workflow/infrastructure/pi/research.command.ts` | Accept `ctx`, call `newSession()` |
| `src/hexagons/workflow/infrastructure/pi/plan.command.ts` | Accept `ctx`, call `newSession()` |
| `src/hexagons/workflow/index.ts` | Update barrel exports |
| `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts` | Add `workflowJournal` to `WorkflowExtensionDeps` |
| `src/hexagons/review/index.ts` | Update barrel exports for SQLite repos |
| `src/cli/extension.ts` | Full rewiring |

---

## Pre-flight (run before any wave)

### T00: Install dependencies + verify PI SDK API surface
**Files:** None (verification only)
**Traces to:** AC13

- [ ] Step 1: Run `npm install` to ensure `node_modules` is present
- [ ] Step 2: Verify `ExtensionCommandContext` type: `grep -r "newSession" node_modules/@mariozechner/pi-coding-agent/` — if found, T15 uses `ctx.newSession()`; if not found, T15 uses fallback (protocol re-injection, no `newSession()` call)
- [ ] Step 3: Record finding in CHECKPOINT.md for T15 consumption

---

## Wave 0 (parallel — no dependencies)

### T01: Extend port interfaces with `reset()` and `findAll()`
**Files:**
- Modify `src/hexagons/workflow/domain/ports/workflow-session.repository.port.ts`
- Modify `src/hexagons/review/domain/ports/review-repository.port.ts`
- Modify `src/hexagons/review/domain/ports/verification-repository.port.ts`
- Modify `src/hexagons/workflow/infrastructure/in-memory-workflow-session.repository.ts`
- Modify `src/hexagons/review/infrastructure/repositories/review/in-memory-review.repository.ts`
- Modify `src/hexagons/review/infrastructure/repositories/verification/in-memory-verification.repository.ts`
**Traces to:** AC1, AC5, AC10, AC12

**WorkflowSessionRepositoryPort** — add after L9:
```typescript
  abstract findAll(): Promise<Result<WorkflowSession[], PersistenceError>>;
  abstract reset(): void;
```

**ReviewRepositoryPort** — add after L8:
```typescript
  abstract findAll(): Promise<Result<Review[], PersistenceError>>;
  abstract reset(): void;
```

**VerificationRepositoryPort** — add after L6:
```typescript
  abstract findAll(): Promise<Result<Verification[], PersistenceError>>;
  abstract reset(): void;
```

**InMemoryWorkflowSessionRepository** — add `findAll()` before `seed()`:
```typescript
  async findAll(): Promise<Result<WorkflowSession[], PersistenceError>> {
    return ok(Array.from(this.store.values()).map((p) => WorkflowSession.reconstitute(p)));
  }
```

**InMemoryReviewRepository** — add `findAll()` before `seed()`:
```typescript
  async findAll(): Promise<Result<Review[], PersistenceError>> {
    return ok(Array.from(this.store.values()).map((p) => Review.reconstitute(p)));
  }
```

**InMemoryVerificationRepository** — add `findAll()` before `seed()`:
```typescript
  async findAll(): Promise<Result<Verification[], PersistenceError>> {
    return ok(Array.from(this.store.values()).map((p) => Verification.reconstitute(p)));
  }
```

**Note:** The in-memory repos already have `reset()` as a concrete method. Adding it to the abstract port just promotes it to a contract requirement. The SQLite stubs (`SqliteReviewRepository`, `SqliteVerificationRepository`) do NOT have `reset()` or `findAll()` — add throw-stubs to maintain compilation between waves.

**SqliteReviewRepository** — add throw-stubs:
```typescript
  findAll(): Promise<Result<Review[], PersistenceError>> { throw new Error("Not implemented"); }
  reset(): void { throw new Error("Not implemented"); }
```

**SqliteVerificationRepository** — add throw-stubs:
```typescript
  findAll(): Promise<Result<Verification[], PersistenceError>> { throw new Error("Not implemented"); }
  reset(): void { throw new Error("Not implemented"); }
```

- [ ] Step 1: Add abstract methods to the 3 port files
- [ ] Step 2: Add `findAll()` to the 3 in-memory implementations
- [ ] Step 3: Add throw-stubs for `reset()` and `findAll()` to `SqliteReviewRepository` and `SqliteVerificationRepository` (keeps compilation intact between waves)
- [ ] Step 4: Run `npx vitest run src/hexagons/workflow/ src/hexagons/review/` — verify PASS (no regressions)
- [ ] Step 5: Commit `feat(S11/T01): extend port interfaces with reset and findAll`

---

### T02: Rename InMemoryContextStagingAdapter to DefaultContextStagingAdapter
**Files:**
- Rename `src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.ts` → `default-context-staging.adapter.ts`
- Rename `src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.spec.ts` → `default-context-staging.adapter.spec.ts`
- Modify `src/hexagons/workflow/index.ts`
**Traces to:** AC14

- [ ] Step 1: `git mv` both files
- [ ] Step 2: Replace class name `InMemoryContextStagingAdapter` → `DefaultContextStagingAdapter` in both files
- [ ] Step 3: Update barrel export in `src/hexagons/workflow/index.ts` — change import path and exported name
- [ ] Step 4: Run `npx vitest run src/hexagons/workflow/infrastructure/default-context-staging.adapter.spec.ts` — verify PASS
- [ ] Step 5: Commit `refactor(S11/T02): rename InMemoryContextStagingAdapter to DefaultContextStagingAdapter`

---

### T03: Create WorkflowJournalPort and entry schema
**Files:**
- Create `src/hexagons/workflow/domain/ports/workflow-journal.port.ts`
- Modify `src/hexagons/workflow/index.ts`
**Traces to:** AC11

```typescript
// src/hexagons/workflow/domain/ports/workflow-journal.port.ts
import type { PersistenceError, Result } from "@kernel";
import { TimestampSchema } from "@kernel";
import { z } from "zod";

export const WorkflowJournalEntrySchema = z.object({
  type: z.enum(["session-created", "phase-transition", "escalation"]),
  sessionId: z.string().min(1),
  milestoneId: z.string().min(1),
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

- [ ] Step 1: Create port file with schema and abstract class
- [ ] Step 2: Add barrel export in `src/hexagons/workflow/index.ts`
- [ ] Step 3: Run `npx vitest run src/hexagons/workflow/` — verify PASS (no regressions)
- [ ] Step 4: Commit `feat(S11/T03): add WorkflowJournalPort and entry schema`

---

### T04: Create SettingsModelProfileResolver
**Files:**
- Create `src/hexagons/workflow/infrastructure/settings-model-profile-resolver.ts`
- Create `src/hexagons/workflow/infrastructure/settings-model-profile-resolver.spec.ts`
- Modify `src/hexagons/workflow/index.ts`
**Traces to:** AC14

```typescript
// src/hexagons/workflow/infrastructure/settings-model-profile-resolver.ts
import type { ComplexityTier, ModelProfileName } from "@kernel";
import type { MergeSettingsUseCase } from "@hexagons/settings";
import { ModelProfileResolverPort } from "../domain/ports/model-profile-resolver.port";
import type { WorkflowPhase } from "../domain/workflow-session.schemas";

export class SettingsModelProfileResolver extends ModelProfileResolverPort {
  constructor(private readonly mergeSettings: MergeSettingsUseCase) {
    super();
  }

  async resolveForPhase(phase: WorkflowPhase, complexity: ComplexityTier): Promise<ModelProfileName> {
    const result = this.mergeSettings.execute({ team: null, local: null, env: process.env });
    if (!result.ok) return "balanced";
    const routing = result.data.modelRouting;
    return routing.phaseOverrides?.[phase] ?? routing.complexityMapping[complexity];
  }
}
```

Test: verify returns correct profile based on complexity mapping, defaults to "balanced" on error.

- [ ] Step 1: Write test file with cases: complexity mapping, phase override, error fallback
- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/infrastructure/settings-model-profile-resolver.spec.ts` — verify FAIL
- [ ] Step 3: Create implementation file
- [ ] Step 4: Run test — verify PASS
- [ ] Step 5: Add barrel export in `src/hexagons/workflow/index.ts`
- [ ] Step 6: Commit `feat(S11/T04): add SettingsModelProfileResolver`

---

### T05: Add `turns` field to TaskMetricsSchema
**Files:**
- Modify `src/hexagons/execution/domain/task-metrics.schemas.ts`
**Traces to:** AC9

Add after L28 (`totalAttempts`):
```typescript
  turns: z.array(z.lazy(() => TurnMetricsSchema)).optional().default([]),
```

Import `TurnMetricsSchema` from `@kernel/agents`.

- [ ] Step 1: Add import and field to schema
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/task-metrics` — verify PASS (`.default([])` ensures backward compat)
- [ ] Step 3: Commit `feat(S11/T05): add turns field to TaskMetricsSchema`

---

## Wave 1 (depends on T01)

### T06: Implement SqliteWorkflowSessionRepository + contract tests
**Files:**
- Create `src/hexagons/workflow/infrastructure/sqlite-workflow-session.repository.ts`
- Create `src/hexagons/workflow/infrastructure/sqlite-workflow-session.repository.spec.ts`
- Modify `src/hexagons/workflow/index.ts`
**Traces to:** AC4, AC5, AC12

Implementation mirrors `SqliteSliceRepository` pattern:
- Constructor: `(db: Database)` — creates `workflow_sessions` table
- `save()`: INSERT OR REPLACE, with milestone cardinality check
- `findById()`: SELECT + reconstitute
- `findByMilestoneId()`: SELECT WHERE milestone_id + reconstitute
- `findAll()`: SELECT * + reconstitute all
- `reset()`: DELETE FROM workflow_sessions
- `last_escalation` column: `JSON.stringify()` on write, `JSON.parse()` on read

Table:
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
  last_escalation TEXT
)
```

Contract test: run against both InMemory and SQLite, testing save/find/cardinality/reset/findAll.

- [ ] Step 1: Write contract test file testing roundtrip, cardinality, reset, findAll
- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/infrastructure/sqlite-workflow-session.repository.spec.ts` — verify FAIL
- [ ] Step 3: Implement SQLite repository
- [ ] Step 4: Run test — verify PASS
- [ ] Step 5: Add barrel export
- [ ] Step 6: Commit `feat(S11/T06): add SqliteWorkflowSessionRepository with contract tests`

---

### T07: Implement SqliteReviewRepository
**Files:**
- Rewrite `src/hexagons/review/infrastructure/repositories/review/sqlite-review.repository.ts`
- Create `src/hexagons/review/infrastructure/repositories/review/review-repository.contract.spec.ts`
- Modify `src/hexagons/review/index.ts`
**Traces to:** AC5, AC12

Implementation:
- Constructor: `(db: Database)` — creates `reviews` table
- `save()`: INSERT OR REPLACE with `JSON.stringify(findings)`
- `findById()`, `findBySliceId()`: SELECT + reconstitute, `JSON.parse(findings)`
- `delete()`: DELETE WHERE id
- `findAll()`: SELECT * + reconstitute
- `reset()`: DELETE FROM reviews

Table:
```sql
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  slice_id TEXT NOT NULL,
  role TEXT NOT NULL,
  agent_identity TEXT NOT NULL,
  verdict TEXT NOT NULL,
  findings TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

- [ ] Step 1: Write contract test file
- [ ] Step 2: Run test — verify FAIL
- [ ] Step 3: Implement SQLite repository (replace stub)
- [ ] Step 4: Run test — verify PASS
- [ ] Step 5: Update barrel export if needed
- [ ] Step 6: Commit `feat(S11/T07): implement SqliteReviewRepository with contract tests`

---

### T08: Implement SqliteVerificationRepository
**Files:**
- Rewrite `src/hexagons/review/infrastructure/repositories/verification/sqlite-verification.repository.ts`
- Create `src/hexagons/review/infrastructure/repositories/verification/verification-repository.contract.spec.ts`
- Modify `src/hexagons/review/index.ts`
**Traces to:** AC5, AC12

Implementation:
- Constructor: `(db: Database)` — creates `verifications` table
- `save()`: INSERT OR REPLACE with `JSON.stringify(criteria)`
- `findBySliceId()`: SELECT WHERE slice_id + reconstitute
- `findAll()`: SELECT * + reconstitute
- `reset()`: DELETE FROM verifications

Table:
```sql
CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  slice_id TEXT NOT NULL,
  agent_identity TEXT NOT NULL,
  criteria TEXT NOT NULL,
  overall_verdict TEXT NOT NULL,
  fix_cycle_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)
```

- [ ] Step 1: Write contract test file
- [ ] Step 2: Run test — verify FAIL
- [ ] Step 3: Implement SQLite repository
- [ ] Step 4: Run test — verify PASS
- [ ] Step 5: Update barrel export if needed
- [ ] Step 6: Commit `feat(S11/T08): implement SqliteVerificationRepository with contract tests`

---

## Wave 2 (depends on T03)

### T09: Implement JsonlWorkflowJournalRepository + tests
**Files:**
- Create `src/hexagons/workflow/infrastructure/jsonl-workflow-journal.repository.ts`
- Create `src/hexagons/workflow/infrastructure/jsonl-workflow-journal.repository.spec.ts`
- Modify `src/hexagons/workflow/index.ts`
**Traces to:** AC11

Mirror `JsonlJournalRepository` pattern:
- Constructor: `(filePath: string)`
- `append()`: `await appendFile(filePath, JSON.stringify(entry) + "\n")`
- `readAll()`: read file, split lines, parse + validate against `WorkflowJournalEntrySchema`

- [ ] Step 1: Write test — append entries, readAll returns them in order
- [ ] Step 2: Run test — verify FAIL
- [ ] Step 3: Implement adapter
- [ ] Step 4: Run test — verify PASS
- [ ] Step 5: Add barrel export
- [ ] Step 6: Commit `feat(S11/T09): add JsonlWorkflowJournalRepository`

---

### T10: Implement ReplayWorkflowJournalUseCase + tests
**Files:**
- Create `src/hexagons/workflow/application/replay-workflow-journal.use-case.ts`
- Create `src/hexagons/workflow/application/replay-workflow-journal.use-case.spec.ts`
- Modify `src/hexagons/workflow/index.ts`
**Traces to:** AC11

```typescript
export class ReplayWorkflowJournalUseCase {
  constructor(
    private readonly journal: WorkflowJournalPort,
    private readonly sessionRepo: WorkflowSessionRepositoryPort,
  ) {}

  async execute(): Promise<Result<number, PersistenceError>> {
    const entries = await this.journal.readAll();
    if (!entries.ok) return entries;

    const sessionMap = new Map<string, WorkflowJournalEntry[]>();
    for (const entry of entries.data) {
      const list = sessionMap.get(entry.sessionId) ?? [];
      list.push(entry);
      sessionMap.set(entry.sessionId, list);
    }

    let reconstructed = 0;
    for (const [, sessionEntries] of sessionMap) {
      const created = sessionEntries.find((e) => e.type === "session-created");
      if (!created) continue;

      // Replay phase transitions to find final state
      let currentPhase = "idle";
      let previousPhase: string | undefined;
      for (const entry of sessionEntries) {
        if (entry.type === "phase-transition" && entry.toPhase) {
          previousPhase = entry.fromPhase;
          currentPhase = entry.toPhase;
        }
      }

      // Reconstruct session via WorkflowSessionBuilder
      const session = new WorkflowSessionBuilder()
        .withId(created.sessionId)
        .withMilestoneId(created.milestoneId)
        .withSliceId(created.sliceId)
        .withPhase(currentPhase as WorkflowPhase)
        .withPreviousPhase(previousPhase as WorkflowPhase | undefined)
        .withAutonomyMode("plan-to-pr")
        .withTimestamps(new Date(created.timestamp), new Date())
        .build();

      const saveResult = await this.sessionRepo.save(session);
      if (!saveResult.ok) return saveResult;
      reconstructed++;
    }
    return ok(reconstructed);
  }
}
```

- [ ] Step 1: Write test with journal entries -> verify sessions are reconstructed and saved
- [ ] Step 2: Run test — verify FAIL
- [ ] Step 3: Implement use case
- [ ] Step 4: Run test — verify PASS
- [ ] Step 5: Add barrel export
- [ ] Step 6: Commit `feat(S11/T10): add ReplayWorkflowJournalUseCase`

---

## Wave 3 (depends on T01, T06, T07, T08)

### T11: Extend StateSnapshot to v2 + Exporter/Importer
**Files:**
- Modify `src/kernel/infrastructure/state-branch/state-snapshot.schemas.ts`
- Modify `src/kernel/services/state-exporter.ts`
- Modify `src/kernel/services/state-importer.ts`
**Traces to:** AC10

**state-snapshot.schemas.ts** changes:
```typescript
// Add imports:
import { WorkflowSessionPropsSchema } from "@hexagons/workflow/domain/workflow-session.schemas";
import { ReviewPropsSchema } from "@hexagons/review/domain/schemas/review.schemas";
import { VerificationPropsSchema } from "@hexagons/review/domain/schemas/verification.schemas";

// Bump version:
export const SCHEMA_VERSION = 2;

// Add to StateSnapshotSchema (after completionRecords):
  workflowSessions: z.array(WorkflowSessionPropsSchema).default([]),
  reviews: z.array(ReviewPropsSchema).default([]),
  verifications: z.array(VerificationPropsSchema).default([]),

// Add migration:
const MIGRATIONS: Record<number, Migration> = {
  1: (old) => ({ ...old, workflowSessions: [], reviews: [], verifications: [] }),
};
```

**StateExporter** — add 3 deps to `StateExporterDeps` interface:
```typescript
  workflowSessionRepo: WorkflowSessionRepositoryPort;
  reviewRepo: ReviewRepositoryPort;
  verificationRepo: VerificationRepositoryPort;
```
Add to `export()` method before building snapshot:
```typescript
const wsResult = await this.deps.workflowSessionRepo.findAll();
if (!wsResult.ok) return err(new SyncError("EXPORT_FAILED", wsResult.error.message));
const rvResult = await this.deps.reviewRepo.findAll();
if (!rvResult.ok) return err(new SyncError("EXPORT_FAILED", rvResult.error.message));
const vfResult = await this.deps.verificationRepo.findAll();
if (!vfResult.ok) return err(new SyncError("EXPORT_FAILED", vfResult.error.message));
```
Add to snapshot object:
```typescript
workflowSessions: wsResult.data.map((ws) => ws.toJSON()),
reviews: rvResult.data.map((r) => r.toJSON()),
verifications: vfResult.data.map((v) => v.toJSON()),
```

**StateImporter** — same 3 deps, add reset calls + reconstitution loops after task imports:
```typescript
this.deps.workflowSessionRepo.reset();
this.deps.reviewRepo.reset();
this.deps.verificationRepo.reset();
// ... reconstitute loops for all 3 entity types ...
```

- [ ] Step 1: Write round-trip test: export v2 snapshot with workflowSessions/reviews/verifications, re-import, verify entities survive. Also test v1 → v2 migration (v1 snapshot with missing fields parses to empty arrays).
- [ ] Step 2: Run `npx vitest run src/kernel/` — verify FAIL (new test expects v2 fields)
- [ ] Step 3: Bump schema to v2, add 3 fields + migration
- [ ] Step 4: Extend StateExporter deps and export logic
- [ ] Step 5: Extend StateImporter deps and import logic
- [ ] Step 6: Run `npx vitest run src/kernel/` — verify PASS
- [ ] Step 7: Commit `feat(S11/T11): extend StateSnapshot to v2 with workflow entities`

---

### T12: Inject WorkflowJournalPort into OrchestratePhaseTransitionUseCase
**Files:**
- Modify `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.ts`
**Traces to:** AC11

Add 5th constructor parameter (optional for backward compat):
```typescript
constructor(
  private readonly sessionRepo: WorkflowSessionRepositoryPort,
  private readonly sliceTransitionPort: SliceTransitionPort,
  private readonly eventBus: EventBusPort,
  private readonly dateProvider: DateProviderPort,
  private readonly workflowJournal?: WorkflowJournalPort,
) {}
```

After session save (L93), before event publish (L96), insert:
```typescript
if (this.workflowJournal) {
  await this.workflowJournal.append({
    type: "phase-transition",
    sessionId: session.id,
    milestoneId: input.milestoneId,
    sliceId: session.sliceId,
    fromPhase,
    toPhase: session.currentPhase,
    trigger: input.trigger,
    timestamp: this.dateProvider.now(),
  });
}
```

- [ ] Step 1: Write test: provide a mock `WorkflowJournalPort`, trigger a phase transition, assert `append()` was called with correct `type: "phase-transition"` entry containing `fromPhase`, `toPhase`, `sessionId`
- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/use-cases/orchestrate-phase-transition` — verify FAIL (new test)
- [ ] Step 3: Add optional WorkflowJournalPort parameter and append call
- [ ] Step 4: Run test — verify PASS
- [ ] Step 5: Commit `feat(S11/T12): add workflow journal write-through on phase transition`

---

### T13: Add turns persistence to RecordTaskMetricsUseCase
**Files:**
- Modify `src/hexagons/execution/application/record-task-metrics.use-case.ts`
**Traces to:** AC9

Add `turns` field to the metrics object built in `onTaskExecutionCompleted()` (after L38):
```typescript
      turns: event.agentResult.turns ?? [],
```

- [ ] Step 1: Write test: emit `TaskExecutionCompletedEvent` with `agentResult.turns` populated (2 turns with tool calls), verify appended `TaskMetrics` contains `turns` array with matching entries
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/application/record-task-metrics` — verify FAIL (new test expects `turns` field)
- [ ] Step 3: Add `turns: event.agentResult.turns ?? []` to metrics construction
- [ ] Step 4: Run test — verify PASS
- [ ] Step 5: Commit `feat(S11/T13): persist turn metrics in task metrics`

---

## Wave 4 (depends on all previous waves)

### T14: Rewire extension.ts composition root
**Files:**
- Modify `src/cli/extension.ts`
**Traces to:** AC1, AC2, AC3, AC6, AC7, AC8, AC13, AC14

This is the critical wiring task. Changes in order:

**1. Add imports** for new/renamed types:
- `SqliteWorkflowSessionRepository`, `DefaultContextStagingAdapter`, `SettingsModelProfileResolver`, `JsonlWorkflowJournalRepository`
- `JsonlJournalRepository` (from `@hexagons/execution`), `MarkdownCheckpointRepository` (from `@hexagons/execution`), `JsonlMetricsRepository` (from `@hexagons/execution`)
- `GetSliceExecutorsUseCase`, `ExecuteSliceUseCase` (real class, not type-only)
- `ComposableGuardrailAdapter`, `ComposableOverseerAdapter`, `ComposablePreDispatchAdapter`
- `DefaultRetryPolicy`, `TimeoutStrategy`, `OverseerConfigSchema`
- 5 guardrail rules: `DangerousCommandRule`, `CredentialExposureRule`, `DestructiveGitRule`, `FileScopeRule`, `SuspiciousContentRule`
- 5 pre-dispatch rules: `ScopeContainmentRule`, `DependencyCheckRule`, `ToolPolicyRule`, `WorktreeStateRule`, `BudgetCheckRule`
- `SqliteReviewRepository`, `SqliteVerificationRepository`

**2. Remove imports** for:
- `InMemoryJournalRepository`, `InMemoryCheckpointRepository`
- `InMemoryReviewRepository`, `InMemoryReviewUIAdapter`, `InMemoryVerificationRepository`
- `InMemoryWorkflowSessionRepository` (from `@hexagons/workflow`)

**3. Delete `NoOpContextStaging` class** (L103-107)

**4. Replace repo instantiations:**
```typescript
// L162: Replace
const workflowSessionRepo = new SqliteWorkflowSessionRepository(stateDb);

// L176-177: Replace
const journalRepo = new JsonlJournalRepository(join(rootTffDir, "journal"));
const checkpointRepo = new MarkdownCheckpointRepository(
  options.projectRoot,
  async (sliceId) => {
    if (await worktreeAdapter.exists(sliceId)) {
      return ok(worktreeAdapter.resolveWorktreePath(sliceId));
    }
    return err(new PersistenceError(`No worktree for slice: ${sliceId}`));
  },
);

// L178-181: Fix resolveSlicePath to use worktreeAdapter
const resolveSlicePath = async (sliceId: string): Promise<Result<string, PersistenceError>> => {
  if (await worktreeAdapter.exists(sliceId)) {
    return ok(worktreeAdapter.resolveWorktreePath(sliceId));
  }
  return err(new PersistenceError(`No worktree for slice: ${sliceId}`));
};

// L200: Replace
const reviewRepository = new SqliteReviewRepository(stateDb);

// L276: Replace
const verificationRepository = new SqliteVerificationRepository(stateDb);

// L283: Replace InMemoryReviewUIAdapter with existing reviewUI
```

**5. Wire ExecuteSliceUseCase** (replace stub L184-186):

**Important:** `WorktreeStateRule` requires `WorktreeStateGitOps` interface (uses `.value` shape), not `WorktreePort` or `GitPort` (which use `.data`). Create thin adapter:
```typescript
const worktreeStateGitOps: WorktreeStateGitOps = {
  async statusAt(cwd: string) {
    const result = await gitPort.statusAt(cwd);
    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, value: { branch: result.data.branch, clean: result.data.clean } };
  },
};
```

```typescript
const metricsRepo = new JsonlMetricsRepository(join(rootTffDir, "metrics.jsonl"));
const overseerConfig = OverseerConfigSchema.parse({});
const guardrailRules = [
  new DangerousCommandRule(), new CredentialExposureRule(), new DestructiveGitRule(),
  new FileScopeRule(), new SuspiciousContentRule(),
];
const guardrail = new ComposableGuardrailAdapter(guardrailRules, new Map(), gitPort);
const overseer = new ComposableOverseerAdapter([new TimeoutStrategy(overseerConfig)]);
const retryPolicy = new DefaultRetryPolicy(2, overseerConfig.retryLoop.threshold);
const preDispatchRules = [
  new ScopeContainmentRule(), new DependencyCheckRule(), new ToolPolicyRule(),
  new WorktreeStateRule(worktreeStateGitOps), new BudgetCheckRule(),
];
const preDispatchGuardrail = new ComposablePreDispatchAdapter(preDispatchRules);
const executeProtocol = readFileSync(
  join(options.projectRoot, "src/resources/protocols/execute.md"), "utf-8",
);

const executeSlice = new ExecuteSliceUseCase({
  taskRepository: taskRepo, waveDetection: new DetectWavesUseCase(),
  checkpointRepository: checkpointRepo, agentDispatch: sharedAgentDispatch,
  worktree: worktreeAdapter, eventBus, journalRepository: journalRepo,
  metricsRepository: metricsRepo, dateProvider, logger,
  templateContent: executeProtocol, guardrail, gitPort, overseer,
  retryPolicy, overseerConfig, preDispatchGuardrail, modelResolver,
  checkpointBeforeRetry: true,
});
```

**6. Wire CachedExecutorQueryAdapter** (replace stub L201-204):
```typescript
const getSliceExecutors = new GetSliceExecutorsUseCase(checkpointRepo);
const executorQueryAdapter = new CachedExecutorQueryAdapter(
  async (sliceId) => getSliceExecutors.execute(sliceId),
);
```

**7. Wire SettingsModelProfileResolver + DefaultContextStagingAdapter:**
```typescript
const settingsResolver = new SettingsModelProfileResolver(new MergeSettingsUseCase());
const contextStaging = new DefaultContextStagingAdapter({ modelProfileResolver: settingsResolver });
```

**8. Wire WorkflowJournalRepository:**
```typescript
const workflowJournal = new JsonlWorkflowJournalRepository(
  join(rootTffDir, "workflow-journal.jsonl"),
);
```

**9. Update StateExporter/StateImporter** with 3 new repo deps:
```typescript
const stateExporter = new StateExporter({
  projectRepo, milestoneRepo, sliceRepo, taskRepo,
  shipRecordRepo: shipRecordRepository, completionRecordRepo: completionRecordRepository,
  workflowSessionRepo, reviewRepo: reviewRepository, verificationRepo: verificationRepository,
});
// Same for stateImporter
```

**10. Update `WorkflowExtensionDeps` interface** (`src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`):
Add `workflowJournal?: WorkflowJournalPort` to the interface. Inside `registerWorkflowExtension`, pass it to the `OrchestratePhaseTransitionUseCase` constructor as the 5th argument. Without this, AC11 "workflow journal captures transitions" would silently fail.

**11. Update `registerWorkflowExtension` call** — replace `new NoOpContextStaging()` with `contextStaging`, add `workflowJournal`.

**12. Update `registerExecutionExtension` call** — replace `executeSliceStub` with `executeSlice`.

**13. Update barrel exports** for `src/hexagons/review/index.ts` — add `SqliteReviewRepository` and `SqliteVerificationRepository` exports (extension.ts imports from these barrels).

- [ ] Step 1: Apply all import changes (add new, remove old)
- [ ] Step 2: Delete `NoOpContextStaging` class
- [ ] Step 3: Replace all InMemory/stub instantiations with production adapters
- [ ] Step 4: Create `worktreeStateGitOps` thin adapter (bridges `GitPort.statusAt` → `WorktreeStateGitOps` shape)
- [ ] Step 5: Wire ExecuteSliceUseCase with 19 deps (use `worktreeStateGitOps` for `WorktreeStateRule`)
- [ ] Step 6: Wire CachedExecutorQueryAdapter with real query
- [ ] Step 7: Wire SettingsModelProfileResolver + DefaultContextStagingAdapter
- [ ] Step 8: Wire JsonlWorkflowJournalRepository
- [ ] Step 9: Update StateExporter/Importer with 3 new repos
- [ ] Step 10: Replace InMemoryReviewUIAdapter with reviewUI in VerifyAcceptanceCriteriaUseCase
- [ ] Step 11: Update `WorkflowExtensionDeps` interface — add `workflowJournal?: WorkflowJournalPort`, wire it to `OrchestratePhaseTransitionUseCase` inside `registerWorkflowExtension`
- [ ] Step 12: Update `registerWorkflowExtension` call — pass `contextStaging` + `workflowJournal`
- [ ] Step 13: Update `registerExecutionExtension` call — pass real `executeSlice`
- [ ] Step 14: Update `src/hexagons/review/index.ts` barrel exports for SQLite repos
- [ ] Step 15: Run `npx vitest run` — verify ALL tests PASS
- [ ] Step 16: Commit `feat(S11/T14): rewire composition root to production adapters`

---

### T15: Fresh context per phase command
**Files:**
- Modify `src/hexagons/workflow/infrastructure/pi/discuss.command.ts`
- Modify `src/hexagons/workflow/infrastructure/pi/research.command.ts`
- Modify `src/hexagons/workflow/infrastructure/pi/plan.command.ts`
**Traces to:** AC13

**Pre-condition:** T00 already verified whether `ExtensionCommandContext.newSession()` exists. Read CHECKPOINT.md.

**Note:** The PI SDK already supports `ctx` as the 2nd handler parameter — `tff:status` in `workflow.extension.ts` L104 uses `handler: async (_args, _ctx) => {...}`. No signature change risk.

**If `newSession()` exists:** For each command, update handler signature to accept `ctx`:
```typescript
// Before:
handler: async (args: string) => {
// After:
handler: async (args: string, ctx) => {
  if (ctx?.newSession) await ctx.newSession();
```

**Fallback (if `newSession()` does not exist):** Accept `ctx` parameter but skip the `newSession()` call. Fresh context is achieved naturally because each slash command starts a new PI turn. Add a `// TODO: call ctx.newSession() when PI SDK supports it` comment.

- [ ] Step 1: Check T00's finding in CHECKPOINT.md — determine which path to take
- [ ] Step 2: Update handler signatures in all 3 command files to accept `ctx` as 2nd parameter
- [ ] Step 3: Add `newSession()` call or fallback comment based on T00 finding
- [ ] Step 4: Run `npx vitest run src/hexagons/workflow/infrastructure/pi/` — verify PASS
- [ ] Step 5: Commit `feat(S11/T15): enforce fresh context per phase command`

---

## Wave 5 (final verification)

### T16: Full test suite + AC verification
**Files:** None (verification only)
**Traces to:** AC15

- [ ] Step 1: Run `npx vitest run` — ALL tests PASS
- [ ] Step 2: Verify AC1: grep `InMemory` in extension.ts — only `InMemoryAgentEventHub` remains
- [ ] Step 3: Verify AC2: grep `NoOp` in extension.ts — zero matches
- [ ] Step 4: Verify AC3: grep `AlwaysUnder` in extension.ts — only `AlwaysUnderBudgetAdapter` remains
- [ ] Step 5: Verify AC7: grep `executeSliceStub` in extension.ts — zero matches
- [ ] Step 6: Commit `chore(S11/T16): verify all acceptance criteria`

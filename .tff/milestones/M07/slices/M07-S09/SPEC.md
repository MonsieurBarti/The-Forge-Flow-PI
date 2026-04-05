# Spec — M07-S09: Platform Commands Batch 2 (Management)

## Problem

5 management commands lack PI-side infrastructure: `/tff:add-slice`, `/tff:remove-slice`, `/tff:rollback`, `/tff:audit-milestone`, `/tff:map-codebase`. Additionally, milestone completion currently embeds audit inline — audit should be a mandatory pre-gate (persisted report, all findings addressed before `complete-milestone` proceeds). Codebase documentation (`.tff/docs/`) is generated manually by the plugin skill — no PI-side command exists to generate ∨ incrementally update it.

## Commands

### 1. `/tff:add-slice` — Add Slice to Milestone

Adds a new slice to the active milestone. Optionally inserts after a specific slice label (default: appends at end).

#### AddSliceUseCase

```typescript
interface AddSliceInput {
  milestoneId: string;
  title: string;
  description?: string;
  afterLabel?: string;  // insert after this label; omit → append at end
}

interface AddSliceOutput {
  sliceId: string;
  sliceLabel: string;
  position: number;
}
```

#### Flow

1. Load milestone — guard: must be `in_progress`
2. `findByMilestoneId()` → existing slices
3. Compute next label: `M{nn}-S{mm}` where `mm` = max existing suffix + 1
4. Compute position: if `afterLabel` provided → find that slice's position + 1; else → max position + 1
5. `Slice.createNew({ kind: "milestone", milestoneId, label, title, description, position })`
6. Save slice

#### Domain Changes: `position` Field

```typescript
// slice.schemas.ts — new field
position: z.number().int().nonnegative().default(0),
```

- `position` is a display ordering field — ¬ affects labels, branches, ∨ artifacts
- Existing slices get `position = index` based on label sort order (migration)
- `findByMilestoneId()` returns slices sorted by `position` (add `ORDER BY position` to SQLite query)
- `afterLabel` inserts at target position + 1; downstream slices shift position + 1

#### SQLite Migration

```sql
ALTER TABLE slices ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
```

Migration backfill: `UPDATE slices SET position = (SELECT COUNT(*) FROM slices s2 WHERE s2.milestone_id = slices.milestone_id AND s2.label < slices.label)` — assigns position by label sort order.

#### Command + Tool

- `/tff:add-slice <title> [--after M07-S08] [--description "..."]`
- `tff_add_slice` tool — same inputs, JSON output

---

### 2. `/tff:remove-slice` — Remove Slice from Milestone

Removes a future slice that hasn't started execution.

#### RemoveSliceUseCase

```typescript
interface RemoveSliceInput {
  sliceLabel: string;
}

interface RemoveSliceOutput {
  removedSliceId: string;
  removedLabel: string;
  cleanupActions: string[];  // e.g. "deleted state branch", "deleted worktree"
}
```

#### Flow

1. `findByLabel(sliceLabel)` → slice
2. Guard: status must be `discussing` ∨ `researching` — ¬ allow removal of planning+ slices
3. Cleanup (best-effort, collect actions):
   a. Delete worktree via `WorktreePort.delete(sliceId)` (if exists)
   b. Delete state branch via `StateBranchOpsPort.deleteBranch(stateBranch)` (if exists)
   c. Delete code branch via `GitPort.deleteBranch(codeBranch)` (if exists)
   d. Delete artifact directory (`.tff/milestones/{ms}/slices/{label}/`)
4. Delete slice from repository
5. Recompact positions: downstream slices shift position - 1

#### Repository Port Change

```typescript
// slice-repository.port.ts — new method
abstract delete(id: Id): Promise<Result<void, PersistenceError>>;
```

SQLite implementation: `DELETE FROM slices WHERE id = ?`

#### Command + Tool

- `/tff:remove-slice <label>`
- `tff_remove_slice` tool — JSON output w/ cleanup actions

---

### 3. `/tff:rollback` — Revert Execution Commits

Wires existing `RollbackSliceUseCase` as a CLI command ∧ AI tool.

#### BaseCommit Discovery

The command auto-discovers `baseCommit` from the most recent checkpoint for the slice:

```typescript
// In rollback command handler:
const checkpoint = await checkpointRepo.findLatest(sliceId);
const baseCommit = checkpoint?.baseCommit ?? input.baseCommit;
```

If no checkpoint ∧ no explicit `--base-commit` → error: "no checkpoint found; provide --base-commit explicitly".

#### Command + Tool

- `/tff:rollback <slice-label> [--base-commit <hash>]`
- `tff_rollback` tool — accepts `sliceLabel`, optional `baseCommit`

#### Output

Markdown report: reverted commits, failed reverts, journal entries processed, new slice status (planning).

---

### 4. `/tff:audit-milestone` — Mandatory Pre-Completion Audit

Standalone read-only audit that produces a persisted `AuditReport`. All findings must be addressed before `complete-milestone` can proceed.

#### AuditMilestoneUseCase

```typescript
interface AuditMilestoneInput {
  milestoneId: string;
  milestoneLabel: string;
  headBranch: string;
  baseBranch: string;
  workingDirectory: string;
}

interface AuditMilestoneOutput {
  milestoneId: string;
  milestoneLabel: string;
  auditReports: AuditReportProps[];
  allPassed: boolean;
  unresolvedFindings: FindingProps[];
  auditedAt: string;  // ISO datetime
}
```

#### Flow

1. Guard: milestone must be `in_progress`, all slices must be `closed`
2. Compute diff: `gitPort.diffAgainst(baseBranch, workingDirectory)` (truncate at 100KB)
3. Read requirements: `milestoneQueryPort.getRequirementsContent(milestoneLabel)`
4. Parallel dispatch: `auditPort.auditMilestone()` × 2 (spec-reviewer + security-auditor) — reuses existing `AuditPort`
5. Merge findings from both reports
6. Persist audit result (new `MilestoneAuditRecord` aggregate)
7. Return report

#### MilestoneAuditRecord (New Aggregate)

```typescript
MilestoneAuditRecordPropsSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema,
  milestoneLabel: z.string().min(1),
  auditReports: z.array(AuditReportSchema),
  allPassed: z.boolean(),
  unresolvedCount: z.number().int().nonnegative(),
  auditedAt: TimestampSchema,
});
```

Stored via `MilestoneAuditRecordRepositoryPort` (new port + SQLite impl).

#### CompleteMilestoneUseCase Gate Change

Modify `CompleteMilestoneUseCase` Step 2 (currently runs inline audit):

**Before:** Dispatches audit agents inline → proceeds regardless of findings (logs warnings).

**After:**
1. Query `MilestoneAuditRecordRepositoryPort.findLatestByMilestoneId(milestoneId)`
2. ¬ found ∨ `allPassed === false` → return `CompleteMilestoneError.auditRequired(milestoneId)` with message: "Run `/tff:audit-milestone` first. All findings must be resolved."
3. Found ∧ `allPassed === true` → proceed (skip inline audit dispatch)

This replaces the entire Step 2 audit block in `CompleteMilestoneUseCase` with a simple record lookup. The audit work is now done by `/tff:audit-milestone` beforehand.

#### Addressing Findings Workflow

1. User runs `/tff:audit-milestone` → gets report with findings
2. User/AI addresses findings (code changes, commits)
3. User re-runs `/tff:audit-milestone` → new record replaces previous (latest wins)
4. When `allPassed === true` → `/tff:complete-milestone` proceeds

#### Command + Tool

- `/tff:audit-milestone [milestone-label]` — defaults to active milestone
- `tff_audit_milestone` tool — same inputs, JSON output

---

### 5. `/tff:map-codebase` — Codebase Documentation Generation

Generates ∧ updates `.tff/docs/` files (ARCHITECTURE.md, CONVENTIONS.md, STACK.md, CONCERNS.md) using parallel doc-writer agents. Uses compressor notation (S07) for token-efficient output.

#### Two Modes

| Mode | Trigger | Behavior |
|---|---|---|
| **Full** | `/tff:map-codebase` (standalone) | Regenerates all 4 docs from scratch |
| **Incremental** | Milestone completion (auto) | Updates only docs affected by milestone diff |

#### MapCodebaseUseCase

```typescript
interface MapCodebaseInput {
  tffDir: string;
  workingDirectory: string;
  mode: "full" | "incremental";
  // Incremental-only:
  milestoneLabel?: string;
  baseBranch?: string;
  headBranch?: string;
}

interface MapCodebaseOutput {
  updatedDocs: string[];       // file names updated
  skippedDocs: string[];       // file names unchanged (incremental only)
  totalAgentsDispatched: number;
}
```

#### Doc-Writer Agent Strategy

Each of the 4 docs gets its own agent dispatch:

| Doc | Agent Focus | Key Inputs |
|---|---|---|
| ARCHITECTURE.md | Layer model, hexagons, domain model, adapter strategy | `src/` directory structure, hexagon barrels, kernel base classes |
| CONVENTIONS.md | Naming, imports, error handling, test structure, code style | `biome.json`, `tsconfig.json`, sample files per pattern |
| STACK.md | Dependencies, runtime, framework, build | `package.json`, `tsconfig.json`, config files |
| CONCERNS.md | Tech debt, type safety, coverage, security, fragile areas | Test counts, `any` usage, stub detection, dependency counts |

#### Full Mode

1. Dispatch 4 agents in parallel via `AgentDispatchPort`
2. Each agent receives: doc-specific prompt + relevant file listing + compressor notation instructions
3. Each agent writes its doc to `.tff/docs/{DOC}.md`
4. Collect results

#### Incremental Mode

1. Compute diff: `gitPort.diffAgainst(baseBranch, workingDirectory)`
2. Classify changed files into categories:
   - Architecture changes: new hexagons, new ports, new aggregates, structural moves
   - Convention changes: biome.json, tsconfig.json, new patterns in domain code
   - Stack changes: package.json, build config, new dependencies
   - Concern changes: new stubs, test file count delta, new TODOs
3. Only dispatch agents for affected categories
4. Each agent receives: existing doc content + diff + "update only what changed" instruction
5. Agent rewrites doc w/ updates (¬ append — full rewrite of the doc, but informed by diff)

#### Integration w/ CompleteMilestoneUseCase

After Step 8 (record merge) ∧ before Step 9 (emit event), add:

```typescript
// Step 8.5: Incremental doc update (best-effort)
await this.mapCodebase.execute({
  tffDir: join(parsed.workingDirectory, ".tff"),
  workingDirectory: parsed.workingDirectory,
  mode: "incremental",
  milestoneLabel: parsed.milestoneLabel,
  baseBranch: parsed.baseBranch,
  headBranch: parsed.headBranch,
});
```

Best-effort: failure ¬ blocks completion. Warning logged.

#### Compressor Notation

All doc-writer agent prompts include the `COMPRESSOR_PROMPT` constant (already injected by `PiAgentDispatchAdapter` from S07). Additionally, doc-writer prompts explicitly instruct:
- Use tables over prose
- Use logic notation (∀, ∃, ∈, ∧, ∨, ¬, →)
- Preserve code blocks ∧ file paths verbatim
- Target: ≤ 40% of equivalent verbose prose

#### Doc-Writer Prompt Files

```
src/resources/prompts/
  map-architecture.md     — architecture doc generation prompt
  map-conventions.md      — conventions doc generation prompt
  map-stack.md            — stack doc generation prompt
  map-concerns.md         — concerns doc generation prompt
```

Each prompt is a `.md` file loaded via `readFileSync` (existing pattern from S08 prompts).

#### Command + Tool

- `/tff:map-codebase [--mode full|incremental]` — defaults to `full`
- `tff_map_codebase` tool — same inputs, JSON output

---

## New Files

```
# Slice domain evolution
slice/domain/slice.schemas.ts                          — add position field (modify)
slice/infrastructure/sqlite-slice.repository.ts        — add delete(), position migration (modify)
slice/domain/ports/slice-repository.port.ts            — add delete() (modify)

# Add-slice
slice/application/add-slice.use-case.ts
slice/application/add-slice.use-case.spec.ts
slice/infrastructure/pi/add-slice.command.ts
slice/infrastructure/pi/add-slice.command.spec.ts
slice/infrastructure/pi/add-slice.tool.ts

# Remove-slice
slice/application/remove-slice.use-case.ts
slice/application/remove-slice.use-case.spec.ts
slice/infrastructure/pi/remove-slice.command.ts
slice/infrastructure/pi/remove-slice.command.spec.ts
slice/infrastructure/pi/remove-slice.tool.ts

# Rollback wiring
execution/infrastructure/pi/rollback.command.ts
execution/infrastructure/pi/rollback.command.spec.ts
execution/infrastructure/pi/rollback.tool.ts

# Audit milestone
review/application/audit-milestone.use-case.ts
review/application/audit-milestone.use-case.spec.ts
review/domain/aggregates/milestone-audit-record.aggregate.ts
review/domain/aggregates/milestone-audit-record.aggregate.spec.ts
review/domain/ports/milestone-audit-record-repository.port.ts
review/domain/schemas/milestone-audit-record.schemas.ts
review/infrastructure/repositories/milestone-audit-record/sqlite-milestone-audit-record.repository.ts
review/infrastructure/repositories/milestone-audit-record/in-memory-milestone-audit-record.repository.ts
review/infrastructure/repositories/milestone-audit-record/milestone-audit-record-repository.contract.spec.ts
review/infrastructure/pi/audit-milestone.command.ts
review/infrastructure/pi/audit-milestone.command.spec.ts
review/infrastructure/pi/audit-milestone.tool.ts

# Map codebase
workflow/application/map-codebase.use-case.ts
workflow/application/map-codebase.use-case.spec.ts
workflow/infrastructure/pi/map-codebase.command.ts
workflow/infrastructure/pi/map-codebase.command.spec.ts
workflow/infrastructure/pi/map-codebase.tool.ts

# Prompts
src/resources/prompts/map-architecture.md
src/resources/prompts/map-conventions.md
src/resources/prompts/map-stack.md
src/resources/prompts/map-concerns.md
```

## Modified Files

```
# Slice domain
slice/domain/slice.schemas.ts                          — position field
slice/domain/slice.aggregate.ts                        — position getter, createNew accepts position
slice/domain/slice.aggregate.spec.ts                   — position tests
slice/domain/ports/slice-repository.port.ts            — add delete()
slice/infrastructure/sqlite-slice.repository.ts        — delete(), position column, ORDER BY position
slice/domain/slice.builder.ts                          — withPosition()

# Execution wiring
execution/infrastructure/pi/execution.extension.ts     — register rollback command + tool

# Review hexagon
review/application/complete-milestone.use-case.ts      — replace inline audit w/ record lookup gate + incremental map-codebase step
review/application/complete-milestone.use-case.spec.ts — update tests for gate change
review/domain/errors/complete-milestone.error.ts       — add auditRequired() factory
review/infrastructure/pi/review.extension.ts           — register audit-milestone command + tool

# Workflow wiring
workflow/infrastructure/pi/workflow.extension.ts        — register map-codebase command + tool

# Extension
cli/extension.ts                                        — wire new repos + use cases
```

## Acceptance Criteria

- **AC1:** `/tff:add-slice` creates slice w/ correct milestone association, auto-generated label, ∧ position. `--after <label>` inserts at correct position ∧ shifts downstream. Default appends at end.
- **AC2:** `/tff:remove-slice` refuses removal of slices in `planning` ∨ later status. Only `discussing` ∧ `researching` slices removable. Cleanup: deletes worktree, state branch, code branch, ∧ artifact directory.
- **AC3:** `/tff:rollback` auto-discovers baseCommit from latest checkpoint. Reverts execution commits, transitions slice to `planning`. Explicit `--base-commit` overrides auto-discovery. Error when no checkpoint ∧ no explicit base commit.
- **AC4:** `/tff:audit-milestone` dispatches spec-reviewer + security-auditor in parallel, persists `MilestoneAuditRecord`. Report shows all findings w/ severity.
- **AC5:** `complete-milestone` refuses to proceed without a passing `MilestoneAuditRecord`. Returns `auditRequired` error w/ clear message. Proceeds when latest record has `allPassed === true`.
- **AC6:** `/tff:map-codebase` full mode: dispatches 4 parallel doc-writer agents, produces ARCHITECTURE.md, CONVENTIONS.md, STACK.md, CONCERNS.md in `.tff/docs/`.
- **AC7:** `/tff:map-codebase` incremental mode: only updates docs affected by milestone diff. Unaffected docs skipped.
- **AC8:** Milestone completion auto-runs incremental map-codebase after merge (best-effort — failure ¬ blocks completion).
- **AC9:** All generated docs use compressor notation (tables > prose, logic symbols, ≤ 40% of verbose equivalent). Code blocks ∧ file paths preserved verbatim.
- **AC10:** All 5 commands have both command registration (human-invocable) ∧ tool registration (AI-callable).

## Non-Goals

- Label renumbering on insert (labels are stable identifiers; `position` handles ordering)
- Bulk add/remove (one slice per invocation)
- Interactive confirmation prompts
- Map-codebase doc merging/conflict resolution (full rewrite per doc, informed by diff in incremental mode)
- Rollback for non-executing slices
- Audit for individual slices (milestone-level only)
- Custom doc templates (4 fixed docs)

## Complexity Signals

- `estimatedFilesAffected`: ~35 (18 new, 17 modified)
- `newFilesCreated`: 18
- `modulesAffected`: 4 (slice, execution, review, workflow)
- `requiresInvestigation`: false — all patterns established in S08
- `architectureImpact`: moderate — audit gate changes `CompleteMilestoneUseCase` control flow
- `hasExternalIntegrations`: true — agent dispatch for map-codebase ∧ audit
- `taskCount`: ~18-22
- `unknownsSurfaced`: 0

**Tier: F-lite**

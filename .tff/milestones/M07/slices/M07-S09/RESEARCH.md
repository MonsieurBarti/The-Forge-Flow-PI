# Research — M07-S09: Platform Commands Batch 2 (Management)

## 1. Slice Domain: `position` Field + `delete()`

### Position Field

**Current state:** `SlicePropsSchema` has 13 fields (id, milestoneId, kind, label, title, description, status, complexity, specPath, planPath, researchPath, createdAt, updatedAt). No ordering mechanism.

**Addition pattern:** Follow existing schema evolution from S08 (kind field added w/ `.default()`):

```typescript
// slice.schemas.ts
position: z.number().int().nonnegative().default(0),
```

**SQLite migration:** Inline `ALTER TABLE` in constructor (no migration framework — table created w/ `CREATE TABLE IF NOT EXISTS`). Same pattern as `kind` column addition:

```sql
ALTER TABLE slices ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
```

Backfill: `UPDATE slices SET position = rowid` (or label-sort-based).

**findByMilestoneId() change:** Add `ORDER BY position ASC` to SQLite query (line 117). In-memory: `.sort((a, b) => a.position - b.position)`.

**Builder:** Add `withPosition(pos: number)` → `_position` field. Default: `0`.

**Aggregate:** Add `position` getter. `createNew()` accepts `position?: number` (default 0).

### Delete Method

**Established pattern** (from `ReviewRepositoryPort`, `CheckpointRepositoryPort`):

```typescript
// Port
abstract delete(id: Id): Promise<Result<void, PersistenceError>>;

// SQLite
async delete(id: Id): Promise<Result<void, PersistenceError>> {
  this.db.prepare<[string]>("DELETE FROM slices WHERE id = ?").run(id);
  return ok(undefined);
}

// In-Memory
async delete(id: Id): Promise<Result<void, PersistenceError>> {
  this.store.delete(id);
  return ok(undefined);
}
```

Idempotent — no error if record doesn't exist. Contract tests needed: delete + findById returns null.

---

## 2. Rollback: BaseCommit Discovery

### Checkpoint Structure

`Checkpoint.baseCommit` stores the commit reference. `CheckpointRepositoryPort.findBySliceId(sliceId)` returns one checkpoint per slice (1:1). Stored as markdown w/ JSON comment block.

**Key finding:** `baseCommit` is initialized as literal `"HEAD"` in `ExecuteSliceUseCase` (line 233). Git resolves this symbolically when `isAncestor()` is called. For rollback, we need the actual SHA — `gitPort.isAncestor("HEAD", hash)` still works because git resolves `HEAD` at call time.

### Wiring Path

`RollbackSliceUseCase` is exported from execution barrel. Dependencies:
- `journalRepo: JournalRepositoryPort` → `JsonlJournalRepository` (already wired in extension.ts)
- `gitPort: GitPort` → `GitCliAdapter` (already wired)
- `phaseTransition: PhaseTransitionPort` → needs to be wired (adapter exists in workflow hexagon)

**Two wiring options:**

A. Add `rollbackExecution()` to `ExecutionCoordinator` → register tool through coordinator (follows pause/resume pattern)
B. Wire `RollbackSliceUseCase` directly in extension → register standalone tool/command

**Decision: Option B** — rollback is a standalone operation, ¬ needs coordinator session management. The coordinator handles execution lifecycle (start/pause/resume); rollback is a post-hoc recovery action.

### PhaseTransitionPort Wiring

`PhaseTransitionPort` is consumed by `RollbackSliceUseCase`. The implementation is `WorkflowSliceTransitionAdapter` (`src/hexagons/slice/infrastructure/workflow-slice-transition.adapter.ts`) which wraps `SliceRepositoryPort` + `OrchestratePhaseTransitionUseCase`.

**In extension.ts:** Already instantiated at line 65 (`WorkflowSliceTransitionAdapter`). Can be passed to `RollbackSliceUseCase` directly.

---

## 3. Audit Gate: Persisted Record + CompleteMilestoneUseCase Change

### New Aggregate: MilestoneAuditRecord

Follow `CompletionRecord` pattern (closest analog):
- Private constructor + `createNew()` + `reconstitute()`
- Props: id, milestoneId, milestoneLabel, auditReports[], allPassed, unresolvedCount, auditedAt
- ¬ mutable — each audit run creates a new record (latest wins)

### Repository

Follow `SqliteCompletionRecordRepository` pattern:
- Separate DB file: `.tff/milestone-audits.db` (follows ship-records.db, completion-records.db convention)
- `findLatestByMilestoneId(milestoneId)` — `SELECT ... ORDER BY audited_at DESC LIMIT 1`
- `save()` — `INSERT OR REPLACE` (upsert)
- `auditReports` stored as JSON string (same pattern as CompletionRecord)

### CompleteMilestoneUseCase Modification

**Current Step 2 (lines 96-140):** Inline audit dispatch → collect reports → log findings.

**New Step 2:**

```typescript
// Step 2: Check for passing audit record
const auditResult = await this.auditRecordRepo.findLatestByMilestoneId(parsed.milestoneId);
if (!auditResult.ok) {
  return err(CompleteMilestoneError.auditRequired(parsed.milestoneId, "Failed to query audit records"));
}
if (!auditResult.data || !auditResult.data.allPassed) {
  return err(CompleteMilestoneError.auditRequired(parsed.milestoneId));
}
const auditReports = auditResult.data.auditReports;
```

Removes: parallel `auditPort.auditMilestone()` dispatch, diff computation (moved to `AuditMilestoneUseCase`).

**New error factory:**

```typescript
static auditRequired(milestoneId: string, reason?: string): CompleteMilestoneError {
  return new CompleteMilestoneError(
    "MILESTONE.AUDIT_REQUIRED",
    reason ?? `Run /tff:audit-milestone first. All findings must be resolved.`,
    { milestoneId },
  );
}
```

**Constructor change:** Add `auditRecordRepo: MilestoneAuditRecordRepositoryPort`. Remove `auditPort: AuditPort` dependency (no longer dispatches inline). This is a **breaking constructor change** — extension.ts wiring must update.

---

## 4. Map-Codebase: Agent Dispatch Architecture

### Agent Type: `doc-writer`

Must add to `AgentTypeSchema` enum in `src/kernel/agents/schemas/agent-card.schema.ts`:

```typescript
z.enum([..., "doc-writer"])
```

Create `src/resources/agents/doc-writer.agent.md`:
```yaml
---
type: doc-writer
displayName: Documentation Writer
purpose: Generate and update structured codebase documentation
scope: Read-only analysis of source code and configuration
modelProfile: balanced
requiredTools: [Read, Glob, Grep, Bash]
skills: [codebase-documentation]
---
```

Read-only tools — doc-writer should ¬ modify code.

### Prompt Strategy (4 Files)

Follow `audit-milestone-intent.md` pattern: template w/ `{{placeholder}}` substitution.

Each prompt specifies:
1. What the doc covers (scope)
2. Input context (file listing, existing doc for incremental)
3. Output format (markdown w/ compressor notation)
4. Structural requirements (tables, headings, code blocks)

### Dispatch Adapter: `PiDocWriterAdapter`

Follow `PiAuditAdapter` pattern:

```typescript
class PiDocWriterAdapter extends DocWriterPort {
  constructor(
    agentDispatch: AgentDispatchPort,
    promptLoader: (path: string) => string,
    modelResolver: (profile: ModelProfileName) => ResolvedModel,
    logger: LoggerPort,
  )
}
```

### Port: `DocWriterPort`

```typescript
abstract class DocWriterPort {
  abstract generateDoc(params: {
    docType: "architecture" | "conventions" | "stack" | "concerns";
    workingDirectory: string;
    existingContent?: string;    // for incremental
    diffContent?: string;        // for incremental
  }): Promise<Result<string, DocWriterError>>;
}
```

### Parallel Dispatch (Full Mode)

```typescript
const results = await Promise.all([
  docWriter.generateDoc({ docType: "architecture", workingDirectory }),
  docWriter.generateDoc({ docType: "conventions", workingDirectory }),
  docWriter.generateDoc({ docType: "stack", workingDirectory }),
  docWriter.generateDoc({ docType: "concerns", workingDirectory }),
]);
```

### Incremental Mode: Diff Classification

Classify changed files into categories by path pattern:

| Pattern | Category |
|---|---|
| `src/hexagons/*/domain/**`, `src/kernel/**`, new `index.ts` barrels | architecture |
| `biome.json`, `tsconfig.json`, `*.schemas.ts`, test patterns | conventions |
| `package.json`, build config, new deps | stack |
| `*.stub.*`, TODO markers, test count delta, `any` usage | concerns |

If ≥1 file matches a category → dispatch agent for that doc. Agent receives existing doc + diff as context.

### CompleteMilestoneUseCase Integration

Add as best-effort step after merge record (Step 8) and before event emission (Step 9):

```typescript
// Step 8.5: Incremental codebase documentation (best-effort)
try {
  await this.mapCodebase.execute({
    tffDir: join(parsed.workingDirectory, ".tff"),
    workingDirectory: parsed.workingDirectory,
    mode: "incremental",
    milestoneLabel: parsed.milestoneLabel,
    baseBranch: parsed.baseBranch,
    headBranch: parsed.headBranch,
  });
} catch (e) {
  this.logger.warn("Incremental doc update failed", { error: String(e) });
}
```

---

## 5. Extension Wiring Summary

### New Instantiations in `extension.ts`

```
AddSliceUseCase(sliceRepo, milestoneRepo, dateProvider)
RemoveSliceUseCase(sliceRepo, worktreePort, stateBranchOps, gitPort, artifactFile)
RollbackSliceUseCase(journalRepo, gitPort, phaseTransition)
AuditMilestoneUseCase(milestoneQueryPort, auditPort, auditRecordRepo, gitPort, dateProvider, generateId)
MapCodebaseUseCase(docWriterPort, gitPort, artifactFile, logger)
```

### New Database

`milestone-audits.db` — separate `better-sqlite3` instance (follows completion-records.db pattern)

### Command Placement

| Command | Register In | Reason |
|---|---|---|
| `tff:add-slice` | `workflow.extension.ts` | Workflow state management |
| `tff:remove-slice` | `workflow.extension.ts` | Workflow state management |
| `tff:rollback` | `execution.extension.ts` | Execution recovery |
| `tff:audit-milestone` | `cli/extension.ts` | Cross-cutting (review + milestone) |
| `tff:map-codebase` | `cli/extension.ts` | Cross-cutting (documentation) |

---

## 6. Risk Assessment

| Risk | Mitigation |
|---|---|
| CompleteMilestoneUseCase constructor break (remove auditPort, add auditRecordRepo) | Single atomic change; only one call site in extension.ts |
| Position backfill on existing slices | Default 0 + label-sort backfill; reversible |
| Doc-writer agent quality | Best-effort; existing docs serve as reference; compressor notation from S07 |
| Incremental diff classification accuracy | Conservative: dispatch all 4 agents if classification unclear |
| AgentTypeSchema enum expansion | Additive change; existing types unaffected |

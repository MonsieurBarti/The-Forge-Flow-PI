# Plan — M07-S09: Platform Commands Batch 2 (Management)

## Summary

5 management commands: add-slice, remove-slice, rollback, audit-milestone, map-codebase. Three-part delivery: domain evolution (Waves 0-1), command use cases + tools (Waves 2-4), extension wiring + CompleteMilestoneUseCase gate change (Wave 5).

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `slice/application/add-slice.use-case.ts` | Add slice w/ position to active milestone |
| `slice/application/add-slice.use-case.spec.ts` | TDD tests |
| `slice/application/remove-slice.use-case.ts` | Remove discussing/researching slice w/ cleanup |
| `slice/application/remove-slice.use-case.spec.ts` | TDD tests |
| `slice/infrastructure/pi/add-slice.command.ts` | /tff:add-slice command handler |
| `slice/infrastructure/pi/add-slice.command.spec.ts` | Tests |
| `slice/infrastructure/pi/add-slice.tool.ts` | tff_add_slice tool |
| `slice/infrastructure/pi/remove-slice.command.ts` | /tff:remove-slice command handler |
| `slice/infrastructure/pi/remove-slice.command.spec.ts` | Tests |
| `slice/infrastructure/pi/remove-slice.tool.ts` | tff_remove_slice tool |
| `execution/infrastructure/pi/rollback.command.ts` | /tff:rollback command handler |
| `execution/infrastructure/pi/rollback.command.spec.ts` | Tests |
| `execution/infrastructure/pi/rollback.tool.ts` | tff_rollback tool |
| `review/application/audit-milestone.use-case.ts` | Standalone audit → persisted record |
| `review/application/audit-milestone.use-case.spec.ts` | TDD tests |
| `review/domain/aggregates/milestone-audit-record.aggregate.ts` | MilestoneAuditRecord aggregate |
| `review/domain/aggregates/milestone-audit-record.aggregate.spec.ts` | Tests |
| `review/domain/schemas/milestone-audit-record.schemas.ts` | MilestoneAuditRecordPropsSchema |
| `review/domain/ports/milestone-audit-record-repository.port.ts` | Repository port |
| `review/infrastructure/repositories/milestone-audit-record/sqlite-milestone-audit-record.repository.ts` | SQLite impl |
| `review/infrastructure/repositories/milestone-audit-record/in-memory-milestone-audit-record.repository.ts` | In-memory impl |
| `review/infrastructure/repositories/milestone-audit-record/milestone-audit-record-repository.contract.spec.ts` | Contract tests |
| `review/infrastructure/pi/audit-milestone.command.ts` | /tff:audit-milestone command handler |
| `review/infrastructure/pi/audit-milestone.command.spec.ts` | Tests |
| `review/infrastructure/pi/audit-milestone.tool.ts` | tff_audit_milestone tool |
| `workflow/application/map-codebase.use-case.ts` | Parallel doc-writer dispatch |
| `workflow/application/map-codebase.use-case.spec.ts` | TDD tests |
| `workflow/domain/ports/doc-writer.port.ts` | DocWriterPort abstract class |
| `review/infrastructure/adapters/doc-writer/pi-doc-writer.adapter.ts` | PiDocWriterAdapter |
| `src/resources/agents/doc-writer.agent.md` | Agent card |
| `src/resources/prompts/map-architecture.md` | Architecture doc prompt |
| `src/resources/prompts/map-conventions.md` | Conventions doc prompt |
| `src/resources/prompts/map-stack.md` | Stack doc prompt |
| `src/resources/prompts/map-concerns.md` | Concerns doc prompt |

### Modified Files

| File | Change |
|---|---|
| `slice/domain/slice.schemas.ts` | Add `position` field |
| `slice/domain/slice.aggregate.ts` | Add `position` getter, accept in createNew |
| `slice/domain/slice.aggregate.spec.ts` | Position tests |
| `slice/domain/slice.builder.ts` | `withPosition()` |
| `slice/domain/ports/slice-repository.port.ts` | Add `delete()` |
| `slice/infrastructure/in-memory-slice.repository.ts` | Implement `delete()`, position handling |
| `slice/infrastructure/sqlite-slice.repository.ts` | `delete()`, position column, `ORDER BY position` |
| `slice/infrastructure/slice-repository.contract.spec.ts` | Delete + position contract tests |
| `kernel/agents/schemas/agent-card.schema.ts` | Add `"doc-writer"` to AgentTypeSchema |
| `review/application/complete-milestone.use-case.ts` | Replace inline audit w/ record lookup gate + incremental map-codebase |
| `review/application/complete-milestone.use-case.spec.ts` | Update tests for gate + map-codebase |
| `review/domain/errors/complete-milestone.error.ts` | Add `auditRequired()` factory |
| `execution/infrastructure/pi/execution.extension.ts` | Register rollback command + tool |
| `cli/extension.ts` | Wire new repos, use cases, commands, tools |
| `slice/index.ts` | Export new use cases |
| `review/index.ts` | Export audit use case + aggregate |
| `workflow/index.ts` | Export MapCodebaseUseCase |

## Task Decomposition

### Wave 0: Domain Schema Evolution (parallel)

#### T01: Slice position field + delete method on repository

**Files:** `slice/domain/slice.schemas.ts`, `slice/domain/slice.aggregate.ts`, `slice/domain/slice.aggregate.spec.ts`, `slice/domain/slice.builder.ts`, `slice/domain/ports/slice-repository.port.ts`, `slice/infrastructure/in-memory-slice.repository.ts`, `slice/infrastructure/sqlite-slice.repository.ts`, `slice/infrastructure/slice-repository.contract.spec.ts`
**Deps:** none
**Model:** balanced

**RED:**
- Test `Slice.createNew()` with `position: 3` → `slice.position === 3`
- Test `Slice.createNew()` without position → `slice.position === 0` (default)
- Test `reconstitute()` preserves position
- Test `findByMilestoneId()` returns slices sorted by position ASC
- Test `delete(id)` → `findById(id)` returns null
- Test `delete(id)` is idempotent (delete non-existent = ok)
- Test `delete(id)` → slice no longer in `findByMilestoneId()` results

**GREEN:**
- Add `position: z.number().int().nonnegative().default(0)` to `SlicePropsSchema`
- Add `position` getter to `Slice` aggregate
- Update `createNew()` to accept optional `position` param (default 0)
- Add `withPosition()` to `SliceBuilder`
- Add `abstract delete(id: Id)` to `SliceRepositoryPort`
- SQLite: `ALTER TABLE slices ADD COLUMN position INTEGER NOT NULL DEFAULT 0`, `DELETE FROM slices WHERE id = ?`, add `ORDER BY position ASC` to `findByMilestoneId()`
- In-memory: `store.delete(id)`, sort result of `findByMilestoneId()` by position

**Commit:** `feat(slice): add position field + delete() to SliceRepositoryPort`

---

#### T02: MilestoneAuditRecord aggregate + schema + repository

**Files:** `review/domain/schemas/milestone-audit-record.schemas.ts` (new), `review/domain/aggregates/milestone-audit-record.aggregate.ts` (new), `review/domain/aggregates/milestone-audit-record.aggregate.spec.ts` (new), `review/domain/ports/milestone-audit-record-repository.port.ts` (new), `review/infrastructure/repositories/milestone-audit-record/in-memory-milestone-audit-record.repository.ts` (new), `review/infrastructure/repositories/milestone-audit-record/sqlite-milestone-audit-record.repository.ts` (new), `review/infrastructure/repositories/milestone-audit-record/milestone-audit-record-repository.contract.spec.ts` (new)
**Deps:** none
**Model:** balanced

**RED:**
- Test `MilestoneAuditRecord.createNew()` w/ passing reports → `allPassed === true`, `unresolvedCount === 0`
- Test `createNew()` w/ FAIL verdict → `allPassed === false`, `unresolvedCount > 0`
- Test `reconstitute()` roundtrip
- Test `findLatestByMilestoneId()` returns most recent record
- Test `findLatestByMilestoneId()` returns null when none exist
- Test save + find roundtrip (contract tests for both impls)

**GREEN:**
- `MilestoneAuditRecordPropsSchema`: id, milestoneId, milestoneLabel, auditReports[], allPassed, unresolvedCount, auditedAt
- `MilestoneAuditRecord` aggregate: `createNew()`, `reconstitute()`, getters
- `MilestoneAuditRecordRepositoryPort`: `save()`, `findLatestByMilestoneId()`, `reset()`
- SQLite impl: separate DB (`milestone-audits.db`), `auditReports` as JSON, `ORDER BY audited_at DESC LIMIT 1`
- In-memory impl: Map + filter + sort

**Commit:** `feat(review): MilestoneAuditRecord aggregate + repository port + adapters`

---

#### T03: Doc-writer agent type + prompt files

**Files:** `kernel/agents/schemas/agent-card.schema.ts`, `src/resources/agents/doc-writer.agent.md` (new), `src/resources/prompts/map-architecture.md` (new), `src/resources/prompts/map-conventions.md` (new), `src/resources/prompts/map-stack.md` (new), `src/resources/prompts/map-concerns.md` (new)
**Deps:** none
**Model:** balanced

**Steps:**
- Add `"doc-writer"` to `AgentTypeSchema` enum
- Create `doc-writer.agent.md`: type=doc-writer, modelProfile=balanced, requiredTools=[Read, Glob, Grep, Bash], skills=[codebase-documentation]
- Create 4 prompt .md files w/ `{{placeholder}}` tokens:
  - `map-architecture.md`: layer model, hexagons, domain model, adapter strategy, dependency rules
  - `map-conventions.md`: naming, imports, error handling, test structure, code style, git conventions
  - `map-stack.md`: language, runtime, framework, deps, build, path aliases
  - `map-concerns.md`: tech debt, type safety, test coverage, security, fragile areas, recommendations
- Each prompt instructs: use compressor notation, tables > prose, code blocks verbatim, include `*Last generated: {date}*` footer

**Commit:** `feat(kernel): doc-writer agent type + 4 documentation prompt templates`

---

### Wave 1: DocWriterPort + Adapter (sequential after T03)

#### T04: DocWriterPort + PiDocWriterAdapter

**Files:** `workflow/domain/ports/doc-writer.port.ts` (new), `review/infrastructure/adapters/doc-writer/pi-doc-writer.adapter.ts` (new)
**Deps:** T03
**Model:** balanced

**RED:**
- Test `generateDoc({ docType: "architecture", ... })` dispatches agent w/ correct prompt template
- Test `generateDoc()` w/ incremental params (existingContent + diffContent) includes them in prompt
- Test dispatch failure → `DocWriterError.dispatchFailed()`
- Test output parsing extracts markdown content

**GREEN:**
- `DocWriterPort`: abstract `generateDoc(params)` → `Result<string, DocWriterError>`
- `PiDocWriterAdapter`: follows `PiAuditAdapter` pattern — load prompt, substitute placeholders, dispatch, return raw output
- `DocWriterError`: `dispatchFailed()`, `parseFailed()`

**Commit:** `feat(workflow): DocWriterPort + PiDocWriterAdapter for codebase documentation`

---

### Wave 2: Use Cases (parallel)

#### T05: AddSliceUseCase

**Files:** `slice/application/add-slice.use-case.ts` (new), `slice/application/add-slice.use-case.spec.ts` (new)
**Deps:** T01
**Model:** balanced

**RED:**
- Test adds slice to active milestone at end (position = max + 1)
- Test `--after M07-S08` inserts at position 9 (if S08 is position 8), shifts downstream
- Test rejects when milestone is not `in_progress`
- Test auto-generates correct label (M07-S12 if max is S11)
- Test downstream slices shift position + 1 on insert

**GREEN:**
- `AddSliceUseCase({ sliceRepo, milestoneRepo, dateProvider })`
- Load milestone → guard `in_progress`
- `findByMilestoneId()` → compute next label suffix, compute position
- If `afterLabel`: find target position, shift all slices w/ position > target (save each)
- `Slice.createNew()` → save

**Commit:** `feat(slice): AddSliceUseCase with positional insertion`

---

#### T06: RemoveSliceUseCase

**Files:** `slice/application/remove-slice.use-case.ts` (new), `slice/application/remove-slice.use-case.spec.ts` (new)
**Deps:** T01
**Model:** balanced

**RED:**
- Test removes `discussing` slice → success, cleanup actions reported
- Test removes `researching` slice → success
- Test rejects `planning` slice → error
- Test rejects `executing` slice → error
- Test rejects `closed` slice → error
- Test cleanup: worktree delete called (if exists)
- Test cleanup: state branch delete called (if exists)
- Test cleanup: code branch delete called (if exists)
- Test cleanup: artifact directory removed
- Test downstream slices recompact positions

**GREEN:**
- `RemoveSliceUseCase({ sliceRepo, worktreePort, stateBranchOps, gitPort, artifactFile, dateProvider })`
- `findByLabel()` → guard status ∈ {discussing, researching}
- Cleanup (best-effort, collect actions): worktree, state branch, code branch, artifacts
- `sliceRepo.delete(id)`
- Recompact: `findByMilestoneId()` → re-assign positions 0..n-1, save each

**Commit:** `feat(slice): RemoveSliceUseCase with cleanup and position recompaction`

---

#### T07: AuditMilestoneUseCase

**Files:** `review/application/audit-milestone.use-case.ts` (new), `review/application/audit-milestone.use-case.spec.ts` (new)
**Deps:** T02
**Model:** quality

**RED:**
- Test dispatches spec-reviewer + security-auditor in parallel
- Test persists MilestoneAuditRecord w/ correct allPassed/unresolvedCount
- Test both PASS → allPassed=true, unresolvedCount=0
- Test one FAIL → allPassed=false, unresolvedCount = count of findings from FAIL report
- Test guard: milestone must be `in_progress`
- Test guard: all slices must be `closed`
- Test diff truncated at 100KB

**GREEN:**
- `AuditMilestoneUseCase({ milestoneQuery, auditPort, auditRecordRepo, gitPort, dateProvider, generateId })`
- Guard: in_progress milestone, all slices closed
- Compute diff + load requirements (same as current CompleteMilestoneUseCase Step 2)
- Parallel dispatch via `Promise.all([auditPort.auditMilestone(...) × 2])`
- Compute allPassed + unresolvedCount from reports
- `MilestoneAuditRecord.createNew()` → save
- Return report

**Commit:** `feat(review): AuditMilestoneUseCase with persisted audit record`

---

#### T08: MapCodebaseUseCase

**Files:** `workflow/application/map-codebase.use-case.ts` (new), `workflow/application/map-codebase.use-case.spec.ts` (new)
**Deps:** T04
**Model:** quality

**RED:**
- Test full mode dispatches 4 agents in parallel, writes 4 docs
- Test incremental mode w/ only package.json changed → dispatches only stack agent
- Test incremental mode w/ new hexagon → dispatches architecture agent
- Test incremental mode w/ no relevant changes → skips all, returns empty
- Test docs written to `.tff/docs/{NAME}.md`
- Test dispatch failure for one doc → others still written (best-effort)

**GREEN:**
- `MapCodebaseUseCase({ docWriter, gitPort, logger })`
- Full mode: `Promise.all([docWriter.generateDoc(...) × 4])` → write each to `.tff/docs/`
- Incremental mode:
  1. `gitPort.diffAgainst(baseBranch)` → changed files
  2. Classify by path patterns → affected doc types
  3. For each affected type: `docWriter.generateDoc({ existingContent, diffContent })`
  4. Write updated docs
- File write via `fs.writeFileSync` (docs are in .tff/, not managed by a port)

**Commit:** `feat(workflow): MapCodebaseUseCase with full + incremental modes`

---

### Wave 3: Commands + Tools (parallel)

#### T09: add-slice command + tool

**Files:** `slice/infrastructure/pi/add-slice.command.ts` (new), `slice/infrastructure/pi/add-slice.command.spec.ts` (new), `slice/infrastructure/pi/add-slice.tool.ts` (new)
**Deps:** T05
**Model:** balanced

**RED:**
- Test parses `/tff:add-slice "My Title" --after M07-S08`
- Test parses `/tff:add-slice "My Title"` (no --after)
- Test calls AddSliceUseCase, sends confirmation message
- Test tool schema, returns JSON output

**GREEN:**
- `registerAddSliceCommand(api, deps)` → parse args, call use case, send message
- `createAddSliceTool(deps)` → Zod schema, execute, return JSON

**Commit:** `feat(slice): /tff:add-slice command + tff_add_slice tool`

---

#### T10: remove-slice command + tool

**Files:** `slice/infrastructure/pi/remove-slice.command.ts` (new), `slice/infrastructure/pi/remove-slice.command.spec.ts` (new), `slice/infrastructure/pi/remove-slice.tool.ts` (new)
**Deps:** T06
**Model:** balanced

**RED:**
- Test parses `/tff:remove-slice M07-S10`
- Test calls RemoveSliceUseCase, sends confirmation w/ cleanup actions
- Test tool schema, returns JSON

**GREEN:**
- `registerRemoveSliceCommand(api, deps)` → parse label, call use case, send message
- `createRemoveSliceTool(deps)` → Zod schema, execute, return JSON

**Commit:** `feat(slice): /tff:remove-slice command + tff_remove_slice tool`

---

#### T11: rollback command + tool

**Files:** `execution/infrastructure/pi/rollback.command.ts` (new), `execution/infrastructure/pi/rollback.command.spec.ts` (new), `execution/infrastructure/pi/rollback.tool.ts` (new)
**Deps:** none (uses existing RollbackSliceUseCase)
**Model:** balanced

**RED:**
- Test parses `/tff:rollback M07-S09`
- Test auto-discovers baseCommit from checkpoint
- Test `--base-commit abc123` overrides auto-discovery
- Test error when no checkpoint ∧ no explicit base commit
- Test sends markdown report w/ reverted commits
- Test tool schema, returns JSON

**GREEN:**
- `registerRollbackCommand(api, deps)` → parse label, find slice, load checkpoint, call RollbackSliceUseCase, format report
- `createRollbackTool(deps)` → Zod schema (sliceLabel, optional baseCommit), execute, return JSON
- BaseCommit discovery: `checkpointRepo.findBySliceId(sliceId)` → `checkpoint.baseCommit`

**Commit:** `feat(execution): /tff:rollback command + tff_rollback tool`

---

#### T12: audit-milestone command + tool

**Files:** `review/infrastructure/pi/audit-milestone.command.ts` (new), `review/infrastructure/pi/audit-milestone.command.spec.ts` (new), `review/infrastructure/pi/audit-milestone.tool.ts` (new)
**Deps:** T07
**Model:** balanced

**RED:**
- Test parses `/tff:audit-milestone` (defaults to active milestone)
- Test parses `/tff:audit-milestone M07` (explicit label)
- Test calls AuditMilestoneUseCase, sends formatted report
- Test report shows findings grouped by agent type
- Test tool schema, returns JSON

**GREEN:**
- `registerAuditMilestoneCommand(api, deps)` → resolve milestone, call use case, format report
- `createAuditMilestoneTool(deps)` → Zod schema (optional milestoneLabel), execute, return JSON

**Commit:** `feat(review): /tff:audit-milestone command + tff_audit_milestone tool`

---

#### T13: map-codebase command + tool

**Files:** `workflow/infrastructure/pi/map-codebase.command.ts` (new), `workflow/infrastructure/pi/map-codebase.command.spec.ts` (new), `workflow/infrastructure/pi/map-codebase.tool.ts` (new)
**Deps:** T08
**Model:** balanced

**RED:**
- Test parses `/tff:map-codebase` (defaults to full mode)
- Test parses `/tff:map-codebase --mode incremental`
- Test calls MapCodebaseUseCase, sends summary
- Test tool schema, returns JSON w/ updatedDocs, skippedDocs

**GREEN:**
- `registerMapCodebaseCommand(api, deps)` → parse mode, call use case, send summary
- `createMapCodebaseTool(deps)` → Zod schema (optional mode), execute, return JSON

**Commit:** `feat(workflow): /tff:map-codebase command + tff_map_codebase tool`

---

### Wave 4: CompleteMilestoneUseCase Gate + Integration

#### T14: CompleteMilestoneUseCase audit gate + map-codebase integration

**Files:** `review/application/complete-milestone.use-case.ts`, `review/application/complete-milestone.use-case.spec.ts`, `review/domain/errors/complete-milestone.error.ts`
**Deps:** T02, T07, T08
**Model:** quality

**RED:**
- Test: no audit record → returns `auditRequired` error
- Test: latest audit has `allPassed === false` → returns `auditRequired` error
- Test: latest audit has `allPassed === true` → proceeds past gate
- Test: audit reports from persisted record used in PR body
- Test: incremental map-codebase called after merge (step 8.5)
- Test: map-codebase failure ¬ blocks completion (best-effort)

**GREEN:**
- Add `auditRequired()` factory to `CompleteMilestoneError`
- Replace Step 2 (inline audit dispatch) w/ audit record lookup:
  - `auditRecordRepo.findLatestByMilestoneId(milestoneId)`
  - ¬ found ∨ `allPassed === false` → return `auditRequired` error
  - Found ∧ `allPassed === true` → use persisted `auditReports`
- Remove `auditPort` from constructor, add `auditRecordRepo` + `mapCodebase`
- Add Step 8.5: `mapCodebase.execute({ mode: "incremental", ... })` (try/catch, warn on failure)

**Commit:** `refactor(review): replace inline audit with persisted audit gate + incremental map-codebase`

---

### Wave 5: Extension Wiring

#### T15: Wire all new commands, tools, repos, use cases in extensions

**Files:** `cli/extension.ts`, `execution/infrastructure/pi/execution.extension.ts`, `slice/index.ts`, `review/index.ts`, `workflow/index.ts`
**Deps:** T09, T10, T11, T12, T13, T14
**Model:** balanced

**Steps:**
- Instantiate `milestone-audits.db` (new Database instance)
- Instantiate repos: `SqliteMilestoneAuditRecordRepository`
- Instantiate use cases: `AddSliceUseCase`, `RemoveSliceUseCase`, `RollbackSliceUseCase`, `AuditMilestoneUseCase`, `MapCodebaseUseCase`
- Instantiate adapter: `PiDocWriterAdapter`
- Update `CompleteMilestoneUseCase` constructor: remove `auditPort`, add `auditRecordRepo` + `mapCodebase`
- Register commands: `tff:add-slice`, `tff:remove-slice` in workflow/slice extension; `tff:rollback` in execution extension; `tff:audit-milestone`, `tff:map-codebase` in cli/extension.ts
- Register tools: `tff_add_slice`, `tff_remove_slice`, `tff_rollback`, `tff_audit_milestone`, `tff_map_codebase`
- Update barrel exports: `slice/index.ts`, `review/index.ts`, `workflow/index.ts`

**Commit:** `feat(cli): wire all S09 commands, tools, repos, and use cases`

---

## Wave Summary

| Wave | Tasks | Parallelism | Focus |
|---|---|---|---|
| 0 | T01, T02, T03 | 3 parallel | Domain schemas + aggregate + agent type |
| 1 | T04 | sequential | DocWriter port + adapter |
| 2 | T05, T06, T07, T08 | 4 parallel | Use cases |
| 3 | T09, T10, T11, T12, T13 | 5 parallel | Commands + tools |
| 4 | T14 | sequential | CompleteMilestoneUseCase gate change |
| 5 | T15 | sequential | Extension wiring |

## Complexity & Model Assignment

| Task | Complexity | Model | Rationale |
|---|---|---|---|
| T01 | Medium | balanced | Schema + repo changes, established patterns |
| T02 | Medium | balanced | New aggregate, follows CompletionRecord pattern |
| T03 | Low | balanced | Agent card + prompt files (no logic) |
| T04 | Medium | balanced | Follows PiAuditAdapter pattern |
| T05 | Medium | balanced | Position insertion + downstream shift |
| T06 | Medium | balanced | Multi-port cleanup + position recompaction |
| T07 | High | quality | Parallel dispatch + persist + guard conditions |
| T08 | High | quality | Parallel dispatch, two modes, diff classification |
| T09 | Low | balanced | Thin command + tool wrapper |
| T10 | Low | balanced | Thin command + tool wrapper |
| T11 | Medium | balanced | BaseCommit discovery + error handling |
| T12 | Low | balanced | Thin command + tool wrapper |
| T13 | Low | balanced | Thin command + tool wrapper |
| T14 | High | quality | Breaking constructor change, gate logic, integration |
| T15 | Medium | balanced | Multi-site wiring |

**Totals:** 15 tasks, 6 waves, 3 quality / 12 balanced

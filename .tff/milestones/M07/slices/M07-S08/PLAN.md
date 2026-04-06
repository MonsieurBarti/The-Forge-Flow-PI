# Plan — M07-S08: Platform Commands Batch 1 (Daily Use)

## Summary

Evolve the Slice domain model to support ad-hoc (quick/debug) slices decoupled from milestones, then implement 6 daily-use platform commands. Two-part delivery: domain model evolution (Waves 0-3), then commands + wiring (Waves 4-6).

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `slice/domain/slice-kind.schemas.ts` | SliceKindSchema enum |
| `workflow/use-cases/quick-start.use-case.ts` | Ad-hoc slice creation + workspace + transitions |
| `workflow/use-cases/quick-start.use-case.spec.ts` | TDD tests |
| `workflow/infrastructure/pi/quick.command.ts` | /tff:quick command handler |
| `workflow/infrastructure/pi/quick.command.spec.ts` | Tests |
| `workflow/infrastructure/pi/quick-start.tool.ts` | tff_quick_start tool |
| `workflow/infrastructure/pi/debug.command.ts` | /tff:debug command handler |
| `workflow/infrastructure/pi/debug.command.spec.ts` | Tests |
| `workflow/infrastructure/pi/health.command.ts` | /tff:health command handler |
| `workflow/infrastructure/pi/health.command.spec.ts` | Tests |
| `workflow/infrastructure/pi/health-check.tool.ts` | tff_health_check tool |
| `workflow/infrastructure/pi/progress.command.ts` | /tff:progress command handler |
| `workflow/infrastructure/pi/progress.command.spec.ts` | Tests |
| `workflow/infrastructure/pi/progress.tool.ts` | tff_progress tool |
| `workflow/infrastructure/pi/settings.command.ts` | /tff:settings command handler |
| `workflow/infrastructure/pi/settings.command.spec.ts` | Tests |
| `workflow/infrastructure/pi/settings-read.tool.ts` | tff_read_settings tool |
| `workflow/infrastructure/pi/settings-update.tool.ts` | tff_update_setting tool |
| `workflow/infrastructure/pi/help.command.ts` | /tff:help command handler |
| `workflow/infrastructure/pi/help.command.spec.ts` | Tests |
| `settings/domain/services/format-settings-cascade.service.ts` | Pure settings cascade formatter |
| `settings/domain/services/format-settings-cascade.service.spec.ts` | Tests |

### Modified Files

| File | Change |
|---|---|
| `slice/domain/slice.schemas.ts` | milestoneId nullable, kind field, label regex relaxed |
| `slice/domain/slice.aggregate.ts` | milestoneId optional, kind getter, invariants |
| `slice/domain/slice.aggregate.spec.ts` | Ad-hoc slice creation tests |
| `slice/domain/slice.builder.ts` | withKind(), withoutMilestone() helpers |
| `slice/domain/ports/slice-repository.port.ts` | findByKind() |
| `slice/infrastructure/in-memory-slice.repository.ts` | findByKind() |
| `slice/infrastructure/sqlite-slice.repository.ts` | Table rebuild, kind column, findByKind |
| `slice/infrastructure/slice-repository.contract.spec.ts` | Contract tests for findByKind, nullable milestoneId |
| `workflow/domain/workflow-session.schemas.ts` | milestoneId nullable |
| `workflow/domain/workflow-session.aggregate.ts` | milestoneId optional in createNew |
| `workflow/domain/workflow-session.aggregate.spec.ts` | Nullable milestoneId tests |
| `workflow/domain/ports/workflow-session.repository.port.ts` | findBySliceId() |
| `workflow/infrastructure/sqlite-workflow-session.repository.ts` | findBySliceId, nullable milestoneId |
| `workflow/use-cases/orchestrate-phase-transition.use-case.ts` | Dual lookup (milestoneId or sliceId) |
| `workflow/use-cases/orchestrate-phase-transition.use-case.spec.ts` | Dual lookup tests |
| `workflow/domain/ports/artifact-file.port.ts` | kind parameter |
| `workflow/infrastructure/node-artifact-file.adapter.ts` | Kind-aware path resolution |
| `kernel/infrastructure/worktree/git-worktree.adapter.ts` | baseBranchFor fallback for non-milestone IDs |
| `kernel/infrastructure/state-branch/fresh-clone.strategy.ts` | quick/debug parent resolution |
| `kernel/services/health-check.service.ts` | 3 new checks, extended deps |
| `kernel/services/health-check.service.spec.ts` | Tests for new checks |
| `cli/extension.ts` | Wire health, progress, settings, help |
| `cli/extension.spec.ts` | Registration assertions |
| `workflow/infrastructure/pi/workflow.extension.ts` | Wire quick, debug |
| `workflow/infrastructure/pi/workflow.extension.spec.ts` | Registration assertions |
| `workflow/index.ts` | Export QuickStartUseCase |
| `slice/index.ts` | Export SliceKindSchema |

## Task Decomposition

### Wave 0: Domain Schemas (parallel)

#### T01: Slice schema + aggregate evolution
**Files:** `slice/domain/slice-kind.schemas.ts` (new), `slice/domain/slice.schemas.ts`, `slice/domain/slice.aggregate.ts`, `slice/domain/slice.aggregate.spec.ts`, `slice/domain/slice.builder.ts`
**Deps:** none
**Model:** balanced

**RED:**
- Test `Slice.createNew()` with `kind: "quick"`, `milestoneId: null` → succeeds
- Test `Slice.createNew()` with `kind: "debug"`, `milestoneId: null` → succeeds
- Test `Slice.createNew()` with `kind: "milestone"`, `milestoneId: null` → throws (invariant)
- Test `Slice.createNew()` with `kind: "quick"`, `milestoneId: someId` → throws (invariant)
- Test label `Q-01` validates, `D-01` validates, `M07-S01` validates
- Test `slice.kind` getter returns correct value
- Test `slice.milestoneId` returns `null` for ad-hoc slices

**GREEN:**
- Create `SliceKindSchema` in new file
- Update `SliceLabelSchema` regex: `/^(M\d{2,}-S\d{2,}|Q-\d{2,}|D-\d{2,})$/`
- Update `SlicePropsSchema`: `milestoneId` nullable, add `kind` field
- Update `Slice.createNew()`: accept `kind` param, enforce invariants
- Add `kind` getter, update `milestoneId` getter return type
- Update `SliceBuilder`: `withKind()`, `withoutMilestone()`

**Commit:** `feat(slice): make milestoneId nullable, add SliceKind for ad-hoc slices`

---

#### T02: WorkflowSession schema + aggregate evolution
**Files:** `workflow/domain/workflow-session.schemas.ts`, `workflow/domain/workflow-session.aggregate.ts`, `workflow/domain/workflow-session.aggregate.spec.ts`
**Deps:** none
**Model:** balanced

**RED:**
- Test `WorkflowSession.createNew()` with `milestoneId: null` → succeeds
- Test `session.milestoneId` returns `null` for ad-hoc sessions
- Test existing milestone-bound session creation still works

**GREEN:**
- Update `WorkflowSessionPropsSchema`: `milestoneId` nullable
- Update `WorkflowSession.createNew()`: accept optional `milestoneId`
- Update `milestoneId` getter return type → `string | null`

**Commit:** `feat(workflow): make WorkflowSession.milestoneId nullable for ad-hoc slices`

---

### Wave 1: Repository Ports + Adapters (parallel)

#### T03: Slice repository evolution (port + adapters + contract tests)
**Files:** `slice/domain/ports/slice-repository.port.ts`, `slice/infrastructure/in-memory-slice.repository.ts`, `slice/infrastructure/sqlite-slice.repository.ts`, `slice/infrastructure/slice-repository.contract.spec.ts`
**Deps:** T01
**Model:** balanced

**RED (contract tests):**
- Test `findByKind("quick")` returns only quick slices
- Test `findByKind("milestone")` returns only milestone slices
- Test save + findById roundtrip with `milestoneId: null`, `kind: "quick"`
- Test `findByMilestoneId()` does not return ad-hoc slices

**GREEN:**
- Add `findByKind(kind)` to `SliceRepositoryPort`
- Implement in `InMemorySliceRepository`: filter by kind
- SQLite: rebuild table (milestone_id nullable, new kind column DEFAULT 'milestone'), implement `findByKind`

**Commit:** `feat(slice): add findByKind to SliceRepositoryPort, evolve SQLite schema`

---

#### T04: WorkflowSession repository evolution (port + adapter)
**Files:** `workflow/domain/ports/workflow-session.repository.port.ts`, `workflow/infrastructure/sqlite-workflow-session.repository.ts`
**Deps:** T02
**Model:** balanced

**RED:**
- Test `findBySliceId(sliceId)` returns session that has this slice assigned
- Test `findBySliceId()` returns null when no match
- Test save/find roundtrip with `milestoneId: null`

**GREEN:**
- Add `findBySliceId(sliceId)` to `WorkflowSessionRepositoryPort`
- Implement in SQLite adapter: query by slice_id column
- Handle nullable milestone_id in serialization/deserialization

**Commit:** `feat(workflow): add findBySliceId to WorkflowSessionRepositoryPort`

---

### Wave 2: Infrastructure Adapters (parallel)

#### T05: ArtifactFilePort + NodeArtifactFileAdapter (kind-aware paths)
**Files:** `workflow/domain/ports/artifact-file.port.ts`, `workflow/infrastructure/node-artifact-file.adapter.ts`
**Deps:** T01 (SliceKind type)
**Model:** balanced

**RED:**
- Test `resolvePath(null, "Q-01", "spec", "quick")` → `.tff/quick/Q-01/SPEC.md`
- Test `resolvePath(null, "D-01", "plan", "debug")` → `.tff/debug/D-01/PLAN.md`
- Test `resolvePath("M07", "M07-S01", "spec")` → `.tff/milestones/M07/slices/M07-S01/SPEC.md` (unchanged)
- Test read/write roundtrip with kind="quick"

**GREEN:**
- Add optional `kind?: SliceKind` to `ArtifactFilePort.read()` and `.write()`
- Make `milestoneLabel` nullable (`string | null`)
- Update `NodeArtifactFileAdapter.resolvePath()`: branch on kind

**Commit:** `feat(workflow): kind-aware artifact paths for ad-hoc slices`

---

#### T06: GitWorktreeAdapter + fresh-clone strategy (ad-hoc patterns)
**Files:** `kernel/infrastructure/worktree/git-worktree.adapter.ts`, `kernel/infrastructure/state-branch/fresh-clone.strategy.ts`
**Deps:** none
**Model:** balanced

**RED:**
- Test `baseBranchFor("Q-01")` → `main` (fallback, not M## pattern)
- Test `baseBranchFor("D-01")` → `main`
- Test `baseBranchFor("M07-S01")` → `milestone/M07` (unchanged)
- Test fresh-clone parent resolution: `quick/Q-01` → `tff-state/main`
- Test fresh-clone parent resolution: `debug/D-01` → `tff-state/main`
- Test existing patterns unchanged: `slice/M07-S01` → `tff-state/milestone/M07`

**GREEN:**
- Update `baseBranchFor()`: if label doesn't match `M##-S##`, return `main`
- Add `quick/*` and `debug/*` patterns to `resolveParentStateBranch()`

**Commit:** `feat(kernel): support ad-hoc slice patterns in worktree + state branch resolution`

---

#### T07: OrchestratePhaseTransitionUseCase (dual lookup)
**Files:** `workflow/use-cases/orchestrate-phase-transition.use-case.ts`, `workflow/use-cases/orchestrate-phase-transition.use-case.spec.ts`
**Deps:** T04 (findBySliceId)
**Model:** balanced

**RED:**
- Test execute with `{ sliceId, trigger, guardContext }` (no milestoneId) → finds session by sliceId
- Test execute with `{ milestoneId, trigger, guardContext }` (no sliceId) → finds by milestoneId (unchanged)
- Test execute with neither → error
- Test journal entry includes sliceId when milestoneId is null

**GREEN:**
- Update `PhaseTransitionInput`: milestoneId optional, add optional sliceId
- Session lookup: milestoneId → `findByMilestoneId()`, else sliceId → `findBySliceId()`
- Validate at least one provided

**Commit:** `feat(workflow): dual session lookup in OrchestratePhaseTransitionUseCase`

---

### Wave 3: QuickStartUseCase

#### T08: QuickStartUseCase + tests
**Files:** `workflow/use-cases/quick-start.use-case.ts` (new), `workflow/use-cases/quick-start.use-case.spec.ts` (new)
**Deps:** T01, T03, T04, T05, T06, T07
**Model:** quality

**RED:**
- Test quick-start with default S complexity → slice created with kind=quick, label=Q-01, milestoneId=null
- Test quick-start auto-generates next label (Q-01, Q-02, Q-03...)
- Test S-tier + plan-to-pr → final phase = executing
- Test S-tier + guided → final phase = planning
- Test F-full + plan-to-pr → final phase = planning
- Test debug kind → slice created with kind=debug, label=D-01
- Test worktree creation called with base branch = main
- Test state branch creation called with correct naming
- Test session created with milestoneId=null, slice assigned

**GREEN:**
- Implement QuickStartUseCase:
  - Accept kind param (quick/debug), title, description, complexity, tffDir
  - Auto-generate label via findByKind → max suffix → increment
  - Create Slice (kind, null milestoneId)
  - Create worktree (base=main)
  - Create state branch (tff-state/{kind}/{label}, parent=tff-state/main)
  - Create WorkflowSession (milestoneId=null)
  - Assign slice + trigger start → skip → conditionally approve

**Commit:** `feat(workflow): QuickStartUseCase for ad-hoc slice creation`

---

### Wave 4: Commands + Tools (parallel)

#### T09: quick.command + quick-start.tool + tests
**Files:** `workflow/infrastructure/pi/quick.command.ts` (new), `workflow/infrastructure/pi/quick.command.spec.ts` (new), `workflow/infrastructure/pi/quick-start.tool.ts` (new)
**Deps:** T08
**Model:** balanced

**RED:**
- Test command parses `[title] [--complexity S]` from args
- Test command calls QuickStartUseCase with correct params
- Test command sends protocol message with slice context
- Test tool schema validates input, calls use case, returns JSON result

**GREEN:**
- `registerQuickCommand(api, deps)` → parse args, call use case, send protocol message
- `createQuickStartTool(deps)` → Zod schema, execute calls use case

**Commit:** `feat(workflow): /tff:quick command + tff_quick_start tool`

---

#### T10: debug.command + tests
**Files:** `workflow/infrastructure/pi/debug.command.ts` (new), `workflow/infrastructure/pi/debug.command.spec.ts` (new)
**Deps:** T08
**Model:** balanced

**RED:**
- Test command creates slice with kind=debug
- Test protocol message includes systematic-debugging skill reference
- Test protocol message includes 4-phase structure

**GREEN:**
- `registerDebugCommand(api, deps)` → parse args, call QuickStartUseCase with kind=debug, send debug protocol message

**Commit:** `feat(workflow): /tff:debug command with systematic-debugging skill injection`

---

#### T11: HealthCheckService extensions + health command + tool + tests
**Files:** `kernel/services/health-check.service.ts`, `kernel/services/health-check.service.spec.ts`, `workflow/infrastructure/pi/health.command.ts` (new), `workflow/infrastructure/pi/health.command.spec.ts` (new), `workflow/infrastructure/pi/health-check.tool.ts` (new)
**Deps:** T03 (findByKind), T05 (kind-aware artifacts)
**Model:** quality

**RED (health checks):**
- Test orphaned worktree detected (worktree exists, no matching active slice)
- Test missing worktree detected (active slice, no worktree)
- Test ad-hoc slices included in worktree cross-reference
- Test journal/SQLite drift detected (journal has 3 completed, SQLite has 2)
- Test no drift when counts match
- Test missing artifact detected (executing slice without PLAN.md)
- Test S-tier slices don't require RESEARCH.md
- Test ad-hoc slices don't require RESEARCH.md

**RED (command + tool):**
- Test command calls runAll(), formats report, sends message
- Test tool returns structured JSON

**GREEN:**
- Extend `HealthCheckDeps` with new ports
- Implement `checkOrphanedWorktrees()`, `checkJournalDrift()`, `checkMissingArtifacts()`
- Update `runAll()` to call new checks
- Implement command handler + tool

**Commit:** `feat(kernel): extend HealthCheckService with worktree, drift, artifact checks + /tff:health command`

---

#### T12: progress.command + progress.tool + tests
**Files:** `workflow/infrastructure/pi/progress.command.ts` (new), `workflow/infrastructure/pi/progress.command.spec.ts` (new), `workflow/infrastructure/pi/progress.tool.ts` (new)
**Deps:** none (uses existing GetStatusUseCase)
**Model:** balanced

**RED:**
- Test formats StatusReport into markdown dashboard
- Test writes STATE.md when stale
- Test skips write when STATE.md is current
- Test tool returns dashboard string + stale flag

**GREEN:**
- `formatDashboard(report: StatusReport)` → pure markdown formatter
- `registerProgressCommand(api, deps)` → call GetStatusUseCase, format, compare, write if stale, send
- `createProgressTool(deps)` → same logic, return JSON

**Commit:** `feat(workflow): /tff:progress command + tff_progress tool`

---

#### T13: FormatSettingsCascadeService + settings command + tools + tests
**Files:** `settings/domain/services/format-settings-cascade.service.ts` (new), `settings/domain/services/format-settings-cascade.service.spec.ts` (new), `workflow/infrastructure/pi/settings.command.ts` (new), `workflow/infrastructure/pi/settings.command.spec.ts` (new), `workflow/infrastructure/pi/settings-read.tool.ts` (new), `workflow/infrastructure/pi/settings-update.tool.ts` (new)
**Deps:** none (uses existing LoadSettingsUseCase, MergeSettingsUseCase)
**Model:** quality

**RED (cascade service):**
- Test source attribution: value from env → [env]
- Test source attribution: value from local → [local]
- Test source attribution: value from team → [team]
- Test source attribution: default value → [default]
- Test all 8 settings domains formatted

**RED (command + tools):**
- Test command loads, merges, formats, sends cascade
- Test read tool returns JSON with annotations
- Test update tool writes YAML, validates via Zod
- Test update tool rejects invalid values

**GREEN:**
- `FormatSettingsCascadeService.format(settings, sources)` → walk leaves, attribute sources
- `registerSettingsCommand(api, deps)` → load + merge + format + send
- `createReadSettingsTool(deps)` → JSON output
- `createUpdateSettingTool(deps)` ��� read YAML, deep-set, validate, write

**Commit:** `feat(settings): FormatSettingsCascadeService + /tff:settings command + tools`

---

#### T14: help.command + tests
**Files:** `workflow/infrastructure/pi/help.command.ts` (new), `workflow/infrastructure/pi/help.command.spec.ts` (new)
**Deps:** none
**Model:** balanced

**RED:**
- Test command calls `api.getCommands()`, filters `tff:*`
- Test commands sorted alphabetically
- Test markdown table format correct

**GREEN:**
- `registerHelpCommand(api)` → getCommands(), filter, sort, format table, send

**Commit:** `feat(workflow): /tff:help command with runtime command discovery`

---

### Wave 5: Extension Wiring

#### T15: Wire all commands + tools in extensions + barrel exports
**Files:** `cli/extension.ts`, `cli/extension.spec.ts`, `workflow/infrastructure/pi/workflow.extension.ts`, `workflow/infrastructure/pi/workflow.extension.spec.ts`, `workflow/index.ts`, `slice/index.ts`
**Deps:** T09, T10, T11, T12, T13, T14
**Model:** balanced

**RED:**
- Test extension.ts registers: tff:health, tff:progress, tff:settings, tff:help commands
- Test extension.ts registers: tff_health_check, tff_progress, tff_read_settings, tff_update_setting tools
- Test workflow.extension.ts registers: tff:quick, tff:debug commands
- Test workflow.extension.ts registers: tff_quick_start tool
- Test barrel exports include SliceKindSchema, QuickStartUseCase

**GREEN:**
- Instantiate QuickStartUseCase, FormatSettingsCascadeService in extensions
- Register all new commands + tools
- Update barrel exports

**Commit:** `feat(cli): wire all S08 commands and tools in extensions`

---

## Wave Summary

| Wave | Tasks | Parallelism | Focus |
|---|---|---|---|
| 0 | T01, T02 | 2 parallel | Domain schemas + aggregates |
| 1 | T03, T04 | 2 parallel | Repository ports + adapters |
| 2 | T05, T06, T07 | 3 parallel | Infrastructure adapters |
| 3 | T08 | sequential | QuickStartUseCase |
| 4 | T09, T10, T11, T12, T13, T14 | 6 parallel | Commands + tools |
| 5 | T15 | sequential | Extension wiring |

## Complexity & Model Assignment

| Task | Complexity | Model |
|---|---|---|
| T01 | Medium — schema + aggregate + invariants | balanced |
| T02 | Low — simple nullable change | balanced |
| T03 | Medium — SQLite table rebuild + contract tests | balanced |
| T04 | Low — add method + implement | balanced |
| T05 | Medium — path branching logic | balanced |
| T06 | Low — regex + fallback | balanced |
| T07 | Medium — dual lookup + validation | balanced |
| T08 | High — composition, label gen, multi-transition | quality |
| T09 | Medium — command + tool | balanced |
| T10 | Low — thin wrapper over quick-start | balanced |
| T11 | High — 3 new health checks + command + tool | quality |
| T12 | Low — formatter + file write | balanced |
| T13 | High — cascade attribution + 3 tools | quality |
| T14 | Low — simple runtime query + format | balanced |
| T15 | Medium — wiring + test assertions | balanced |

**Totals:** 15 tasks, 6 waves, 3 quality / 12 balanced

# Spec — M07-S08: Platform Commands Batch 1 (Daily Use)

## Problem

6 daily-use commands (`/tff:quick`, `/tff:debug`, `/tff:health`, `/tff:progress`, `/tff:settings`, `/tff:help`) have Claude Code skill definitions in the TFF plugin but no PI-side infrastructure. Additionally, quick/debug slices require domain model evolution — the current Slice aggregate hard-couples to milestones at every layer.

## Part 1: Ad-Hoc Slice Infrastructure

Quick and debug slices are first-class slices that skip discuss+research ceremony. They are NOT milestone-bound. They can be any complexity tier.

### 1.1 Slice Aggregate Evolution

#### New `SliceKind`

```typescript
export const SliceKindSchema = z.enum(["milestone", "quick", "debug"]);
export type SliceKind = z.infer<typeof SliceKindSchema>;
```

#### Schema Changes (`slice.schemas.ts`)

```typescript
// Before: /^M\d{2,}-S\d{2,}$/
// After: also allows Q-## and D-##
export const SliceLabelSchema = z.string().regex(/^(M\d{2,}-S\d{2,}|Q-\d{2,}|D-\d{2,})$/);

export const SlicePropsSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema.nullable().default(null),  // was: IdSchema (required)
  kind: SliceKindSchema.default("milestone"),       // new
  label: SliceLabelSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  status: SliceStatusSchema,
  complexity: ComplexityTierSchema.nullable().default(null),
  specPath: z.string().nullable().default(null),
  planPath: z.string().nullable().default(null),
  researchPath: z.string().nullable().default(null),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
```

#### Aggregate Changes (`slice.aggregate.ts`)

- `milestoneId` getter returns `string | null`
- New `kind` getter returns `SliceKind`
- `createNew()` accepts optional `milestoneId` + required `kind`
- Invariant: `kind === "milestone"` → `milestoneId` must be non-null
- Invariant: `kind ∈ {"quick", "debug"}` → `milestoneId` must be null

#### SQLite Changes (`sqlite-slice.repository.ts`)

```sql
-- milestone_id: NOT NULL → nullable
-- new column: kind
ALTER TABLE slices ADD COLUMN kind TEXT NOT NULL DEFAULT 'milestone';
-- milestone_id becomes nullable (requires table rebuild in SQLite)
```

Migration: existing rows get `kind = 'milestone'` (default). Existing `milestone_id` values preserved.

#### Repository Port Changes (`slice-repository.port.ts`)

```typescript
abstract findByKind(kind: SliceKind): Promise<Result<Slice[], PersistenceError>>;
```

Existing `findByMilestoneId()` unchanged — returns only milestone-bound slices.

### 1.2 WorkflowSession Evolution

#### Schema Change (`workflow-session.schemas.ts`)

```typescript
// milestoneId becomes nullable
milestoneId: IdSchema.nullable().default(null),  // was: IdSchema (required)
```

#### Aggregate Change (`workflow-session.aggregate.ts`)

- `milestoneId` getter returns `string | null`
- `createNew()` accepts optional `milestoneId`
- Ad-hoc slices: one session per slice (1:1), milestoneId = null

#### Repository Port Change (`workflow-session.repository.port.ts`)

```typescript
abstract findBySliceId(sliceId: Id): Promise<Result<WorkflowSession | null, PersistenceError>>;
```

### 1.3 OrchestratePhaseTransitionUseCase Evolution

```typescript
export interface PhaseTransitionInput {
  milestoneId?: string;  // was: required
  sliceId?: string;      // new — for ad-hoc slices
  trigger: WorkflowTrigger;
  guardContext: GuardContext;
}
```

Session lookup: if `milestoneId` provided → `findByMilestoneId()`. Else if `sliceId` → `findBySliceId()`. At least one required.

### 1.4 Artifact Paths

Milestone slices (unchanged): `.tff/milestones/{msLabel}/slices/{sliceLabel}/{artifact}`

Ad-hoc slices: `.tff/{kind}/{sliceLabel}/{artifact}`
- Quick: `.tff/quick/Q-01/SPEC.md`
- Debug: `.tff/debug/D-01/PLAN.md`

#### ArtifactFilePort Change

Current interface takes `(milestoneLabel, sliceLabel, artifactType)`. For ad-hoc slices, milestoneLabel is irrelevant.

New overloaded approach:

```typescript
abstract class ArtifactFilePort {
  abstract write(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    content: string,
    kind?: SliceKind,  // default "milestone"
  ): Promise<Result<string, FileIOError>>;

  abstract read(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    kind?: SliceKind,
  ): Promise<Result<string | null, FileIOError>>;
}
```

`NodeArtifactFileAdapter.resolvePath()`:
- `kind === "milestone"` → `.tff/milestones/{msLabel}/slices/{sliceLabel}/{file}`
- `kind === "quick"` → `.tff/quick/{sliceLabel}/{file}`
- `kind === "debug"` → `.tff/debug/{sliceLabel}/{file}`

### 1.5 Worktree & State Branch Naming

| Kind | Code Branch | State Branch | Base Branch | Worktree Path |
|---|---|---|---|---|
| milestone | `slice/{label}` | `tff-state/slice/{label}` | `milestone/{msLabel}` | `.tff/worktrees/{label}` |
| quick | `quick/{label}` | `tff-state/quick/{label}` | `main` | `.tff/worktrees/{label}` |
| debug | `debug/{label}` | `tff-state/debug/{label}` | `main` | `.tff/worktrees/{label}` |

#### GitWorktreeAdapter Changes

- `branchFor()` and `baseBranchFor()` need slice kind awareness (or callers pass explicit branch names)
- `create()` already takes `(sliceId, baseBranch)` — callers pass the right base branch
- `list()` and `validate()` use `baseBranchFor()` internally — must handle non-milestone IDs (fallback to `main` if label doesn't match `M##-S##`)

#### State Branch Parent Resolution (`fresh-clone.strategy.ts`)

Add patterns:
```
quick/<label>  → tff-state/main
debug/<label>  → tff-state/main
```

### 1.6 Label Auto-Generation

Quick: query `sliceRepo.findByKind("quick")` → find max numeric suffix → increment → `Q-{next}`
Debug: query `sliceRepo.findByKind("debug")` → same → `D-{next}`

---

## Part 2: Commands

### 2.1 `/tff:quick` — Quick-Start Slice

#### QuickStartUseCase

Creates an ad-hoc slice (kind=quick), sets up workspace, transitions to planning.

```typescript
interface QuickStartInput {
  title: string;
  description: string;
  complexity?: ComplexityTier;  // default "S", any tier allowed
  tffDir: string;
}

interface QuickStartOutput {
  sliceId: string;
  sliceLabel: string;
  sessionId: string;
  currentPhase: WorkflowPhase;
  autonomyMode: AutonomyMode;
  complexity: ComplexityTier;
}
```

#### Flow

1. Auto-generate label (`Q-01`, `Q-02`, ...)
2. `Slice.createNew({ kind: "quick", milestoneId: null, label, title, complexity })`
3. Save slice
4. Create worktree (base branch = `main`)
5. Create state branch (`tff-state/quick/{label}`, parent = `tff-state/main`)
6. Create `WorkflowSession` (milestoneId = null)
7. Assign slice → trigger `start` (idle → discussing)
8. Trigger `skip` (discussing → planning) via `OrchestratePhaseTransitionUseCase`
9. If S-tier + plan-to-pr autonomy: trigger `approve` (planning → executing)
10. Persist all

| Complexity | Autonomy | Final Phase |
|---|---|---|
| S | plan-to-pr | executing |
| S | guided | planning (gate) |
| F-lite / F-full | any | planning (gate) |

#### Command handler

```
/tff:quick [title] [--complexity S|F-lite|F-full]
```

Sends protocol message with slice context + skill instructions.

#### Tool

`tff_quick_start` — AI-callable, same inputs as use case.

---

### 2.2 `/tff:debug` — Debug Slice

Reuses `QuickStartUseCase` with `kind: "debug"`:

1. Call `QuickStartUseCase` logic but create slice with `kind: "debug"`, label `D-xx`
2. Command handler sends debug-specific protocol message:
   - Injects `systematic-debugging` skill reference
   - Includes 4-phase structure (reproduce → hypothesize → test → fix)
   - Provides bug description as context

No separate use case — debug is a command-level concern. The use case accepts a `kind` parameter.

#### Command handler

```
/tff:debug [bug description] [--complexity S|F-lite|F-full]
```

---

### 2.3 `/tff:health` — State Consistency Check

#### Extended HealthCheckService

Current checks (4): ensurePostCheckoutHook, ensureGitignore, cleanStaleLocks, checkOrphanedState.

New checks (3):

##### Orphaned Worktrees
- `WorktreePort.list()` → active worktrees
- Cross-reference with ALL active slices (milestone-bound + ad-hoc via `findByKind`)
- Active statuses: `discussing, researching, planning, executing, verifying, reviewing`
- Worktree without matching active slice → orphaned (warning)
- Active slice without worktree → missing worktree (warning)

##### Journal/SQLite Drift Detection
For each active slice with journal entries:
1. `JournalRepositoryPort.readAll(sliceId)` → count `task-completed` entries
2. `TaskRepositoryPort.findBySliceId(sliceId)` → count tasks with status `completed`
3. Mismatch → drift warning with counts

Cross-validate: every `task-completed` journal entry has matching completed task in SQLite.

##### Missing Artifacts
Per-status required artifacts (ad-hoc slices skip discuss/research, so only check from planning onward):

| Slice Status | Required Artifacts | Exception |
|---|---|---|
| researching+ | SPEC.md | — |
| planning+ | SPEC.md | RESEARCH.md not required if S-tier or ad-hoc |
| executing+ | SPEC.md, PLAN.md | — |

Uses `ArtifactFilePort.read()` with appropriate kind parameter. Missing → warning.

#### Extended HealthCheckDeps

```typescript
interface HealthCheckDeps {
  // existing:
  gitHookPort: GitHookPort;
  stateBranchOps: StateBranchOpsPort;
  gitPort: GitPort;
  hookScriptContent: string;
  projectRoot: string;
  // new:
  worktreePort: WorktreePort;
  sliceRepo: SliceRepositoryPort;
  taskRepo: TaskRepositoryPort;
  journalRepo: JournalRepositoryPort;
  artifactFile: ArtifactFilePort;
}
```

#### HealthCheckReport Extension

```typescript
interface HealthCheckReport {
  fixed: string[];
  warnings: string[];
  driftDetails: DriftDetail[];  // new
}

interface DriftDetail {
  sliceId: string;
  sliceLabel: string;
  journalCompleted: number;
  sqliteCompleted: number;
}
```

#### Command + Tool

- `/tff:health` → runs `HealthCheckService.runAll()`, formats as markdown, sends via `sendUserMessage()`
- `tff_health_check` tool → returns structured `HealthCheckReport` JSON

---

### 2.4 `/tff:progress` — Dashboard

No new use case. Uses existing `GetStatusUseCase`.

#### Command handler flow

1. Call `GetStatusUseCase.execute()`
2. Format `StatusReport` → markdown dashboard (pure function)
3. Read existing `.tff/STATE.md`
4. Compare — if different, write updated STATE.md (direct `fs.writeFileSync`)
5. Send dashboard via `sendUserMessage()`

#### Dashboard format

```
# Progress — M07: {title}

## Summary
- Slices: 6/10 completed (60%)
- Tasks: 15/31 completed (48%)

## Slices
| Slice | Status | Tasks | Progress |
|---|---|---|---|
| ... | ... | ... | ... |

STATE.md: ✓ up-to-date (or: ⚠ auto-fixed — was stale)
```

#### Tool

`tff_progress` — returns dashboard string + stale flag.

---

### 2.5 `/tff:settings` — View Settings Cascade

#### Read flow

1. `LoadSettingsUseCase.execute(projectRoot)` → raw sources (team, local, env)
2. `MergeSettingsUseCase.execute(sources)` → merged `ProjectSettings`
3. `FormatSettingsCascadeService.format(settings, sources)` → cascade markdown

#### FormatSettingsCascadeService

Pure formatting service. For each leaf value in merged settings:
- If value present in `env` source → `[env]`
- Else if value in `local` differs from team-only merge → `[local]`
- Else if value in `team` differs from defaults → `[team]`
- Else → `[default]`

Output: markdown table per settings domain (modelRouting, autonomy, autoLearn, beads, guardrails, overseer, hotkeys, fallback).

#### Settings write tool

`tff_update_setting` — takes `{ key: string, value: unknown }` where key is dot-path (e.g., `autonomy.mode`):
1. Read `.tff/settings.yaml` via `fs.readFileSync`
2. Parse YAML via `yaml` package (^2.8.3, already a dependency)
3. Deep-set the key
4. Validate merged result through Zod (catch invalid values before writing)
5. Serialize → write

#### Command + Tools

- `/tff:settings` → load + merge + format → sendUserMessage
- `tff_read_settings` tool → returns structured settings JSON with source annotations
- `tff_update_setting` tool → writes single key-value to settings.yaml

---

### 2.6 `/tff:help` — Command Reference

Uses `api.getCommands()` → filter `tff:*` → sort alphabetically → format as markdown table → sendUserMessage.

No tool needed — display-only command.

---

## Extension Wiring

### Placement

| Command | Register in | Reason |
|---|---|---|
| `tff:quick` | workflow extension | Manages workflow state |
| `tff:debug` | workflow extension | Same lifecycle as quick |
| `tff:health` | extension.ts | Cross-cutting (kernel service) |
| `tff:progress` | extension.ts | Cross-cutting |
| `tff:settings` | extension.ts | Settings hexagon access |
| `tff:help` | extension.ts | Cross-cutting |

### New Instantiations

```
QuickStartUseCase(sliceRepo, sessionRepo, orchestratePhaseTransition, worktreePort, stateSyncPort, dateProvider, autonomyProvider)
FormatSettingsCascadeService()
```

### New Commands & Tools

```
Commands: tff:quick, tff:debug, tff:health, tff:progress, tff:settings, tff:help
Tools: tff_quick_start, tff_health_check, tff_progress, tff_read_settings, tff_update_setting
```

## New Files

```
# Domain model evolution
slice/domain/slice-kind.schemas.ts                          — SliceKindSchema
workflow/use-cases/quick-start.use-case.ts                  — QuickStartUseCase
workflow/use-cases/quick-start.use-case.spec.ts

# Commands & tools
workflow/infrastructure/pi/quick.command.ts
workflow/infrastructure/pi/quick.command.spec.ts
workflow/infrastructure/pi/quick-start.tool.ts
workflow/infrastructure/pi/debug.command.ts
workflow/infrastructure/pi/debug.command.spec.ts
workflow/infrastructure/pi/health.command.ts
workflow/infrastructure/pi/health.command.spec.ts
workflow/infrastructure/pi/health-check.tool.ts
workflow/infrastructure/pi/progress.command.ts
workflow/infrastructure/pi/progress.command.spec.ts
workflow/infrastructure/pi/progress.tool.ts
workflow/infrastructure/pi/settings.command.ts
workflow/infrastructure/pi/settings.command.spec.ts
workflow/infrastructure/pi/settings-read.tool.ts
workflow/infrastructure/pi/settings-update.tool.ts
workflow/infrastructure/pi/help.command.ts
workflow/infrastructure/pi/help.command.spec.ts
settings/domain/services/format-settings-cascade.service.ts
settings/domain/services/format-settings-cascade.service.spec.ts
```

## Modified Files

```
# Domain model evolution (Part 1)
slice/domain/slice.schemas.ts                   — milestoneId nullable, kind field, label regex relaxed
slice/domain/slice.aggregate.ts                 — milestoneId optional, kind getter, createNew updated
slice/domain/slice.aggregate.spec.ts            — tests for ad-hoc slice creation
slice/infrastructure/sqlite-slice.repository.ts — milestone_id nullable, kind column, findByKind
slice/domain/ports/slice-repository.port.ts     — add findByKind
workflow/domain/workflow-session.schemas.ts      — milestoneId nullable
workflow/domain/workflow-session.aggregate.ts    — milestoneId optional in createNew
workflow/domain/workflow-session.aggregate.spec.ts
workflow/domain/ports/workflow-session.repository.port.ts — add findBySliceId
workflow/infrastructure/sqlite-workflow-session.repository.ts — findBySliceId, nullable milestoneId
workflow/use-cases/orchestrate-phase-transition.use-case.ts — input accepts sliceId, dual lookup
workflow/use-cases/orchestrate-phase-transition.use-case.spec.ts
workflow/infrastructure/node-artifact-file.adapter.ts     — kind-aware path resolution
workflow/domain/ports/artifact-file.port.ts               — kind parameter
kernel/infrastructure/worktree/git-worktree.adapter.ts    — baseBranchFor handles non-milestone IDs
kernel/infrastructure/state-branch/fresh-clone.strategy.ts — quick/debug parent resolution
kernel/services/health-check.service.ts                    — 3 new checks, extended deps
kernel/services/health-check.service.spec.ts

# Extension wiring
cli/extension.ts                                            — wire health, progress, settings, help
cli/extension.spec.ts
workflow/infrastructure/pi/workflow.extension.ts             — wire quick, debug
workflow/infrastructure/pi/workflow.extension.spec.ts
```

## Acceptance Criteria

- **AC1:** `/tff:quick` creates ad-hoc slice (kind=quick, no milestone), auto-generates `Q-xx` label, creates worktree (base=main) + state branch, transitions to planning (any complexity) or executing (S-tier + plan-to-pr)
- **AC2:** `/tff:debug` creates ad-hoc slice (kind=debug, no milestone), auto-generates `D-xx` label, sends debug protocol message with systematic-debugging skill reference and 4-phase structure
- **AC3:** Quick/debug slices support any complexity tier (S, F-lite, F-full)
- **AC4:** `/tff:health` detects orphaned worktrees (including ad-hoc slices), journal/SQLite drift, and missing artifacts (kind-aware path resolution)
- **AC5:** `/tff:progress` renders dashboard using `GetStatusUseCase`, auto-regenerates STATE.md if stale. No new use case.
- **AC6:** `/tff:settings` shows settings cascade with source attribution ([default], [team], [local], [env]). `tff_update_setting` validates via Zod before writing.
- **AC7:** `/tff:help` discovers commands at runtime via `api.getCommands()`, filters to `tff:*`
- **AC8:** All commands respect autonomy mode — quick S-tier auto-approves plan only in plan-to-pr mode
- **AC9:** Existing milestone-bound slices unaffected — `milestoneId` defaults to required for kind=milestone, nullable for kind=quick/debug
- **AC10:** Ad-hoc artifact paths: `.tff/quick/{label}/`, `.tff/debug/{label}/` (not under milestones/)

## Non-Goals

- Cost/budget tracking in progress dashboard
- Interactive settings editor / TUI
- Debug-specific domain model beyond kind=debug tag
- Bulk artifact migration on health check (report only)
- Settings schema migration on write
- Modifying existing milestone-bound command flows (discuss, research, plan, execute)

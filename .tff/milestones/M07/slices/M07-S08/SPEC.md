# Spec — M07-S08: Platform Commands Batch 1 (Daily Use)

## Problem

6 daily-use commands (`/tff:quick`, `/tff:debug`, `/tff:health`, `/tff:progress`, `/tff:settings`, `/tff:help`) have Claude Code skill definitions in the TFF plugin but no PI-side infrastructure. The skills send prompts but lack commands to initialize state, tools to perform operations, and use cases for business logic.

## Approach

Each command follows the established extension pattern: `registerCommand()` for entry points, `registerTool()` for AI-callable operations, use cases for domain logic. All wiring through `extension.ts`.

## Design

### 1. `/tff:quick` — Quick-Start Slice

#### Problem
Quick/debug slices live **outside milestone ceremonies** — they skip discuss + research. Default complexity is S-tier but can be overridden to F-lite or F-full.

#### QuickStartUseCase

Composes existing `StartDiscussUseCase` + auto-transitions:

```typescript
interface QuickStartInput {
  milestoneId: string;
  title: string;
  description: string;
  complexity?: ComplexityTier;   // default "S"
  tffDir: string;
}

interface QuickStartOutput {
  sliceId: string;
  sliceLabel: string;
  sessionId: string;
  currentPhase: WorkflowPhase;   // "planning" | "executing"
  autonomyMode: AutonomyMode;
  complexity: ComplexityTier;
}
```

#### Flow

1. Create slice in active milestone (`Slice.createNew`)
2. Set complexity (default S)
3. Run `StartDiscussUseCase.execute()` → idle → discussing (creates worktree + state branch)
4. Trigger `skip` → discussing → planning
5. If S-tier + plan-to-pr autonomy: trigger `approve` → planning → executing

| Complexity | Autonomy | Final Phase |
|---|---|---|
| S | plan-to-pr | executing |
| S | guided | planning (gate) |
| F-lite / F-full | any | planning (gate) |

#### Dependencies

- `SliceRepositoryPort`, `MilestoneRepositoryPort`, `WorkflowSessionRepositoryPort`
- `StartDiscussUseCase` (reuses existing — workspace creation, session setup)
- `DateProviderPort`, `AutonomyModeProvider`

#### Command handler

```
/tff:quick [title] [--complexity S|F-lite|F-full]
```

Resolves active milestone. Creates slice with auto-generated label (`M07-Qxx`). Sends protocol message with slice context + skill instructions.

#### Tool

`tff_quick_start` — AI-callable tool for programmatic quick-start (same inputs as use case).

---

### 2. `/tff:debug` — Debug Slice

#### Problem
Debug slices also live outside ceremonies. Create a slice tagged for debugging with the systematic-debugging skill injected. Default S-tier, overridable.

#### Reuses QuickStartUseCase

Debug is quick-start with a `debug` flavor:

1. Call `QuickStartUseCase.execute()` with title derived from bug description
2. Command handler sends a debug-specific protocol message that:
   - Injects the `systematic-debugging` skill reference
   - Includes the 4-phase structure (reproduce → hypothesize → test → fix)
   - Provides the bug description as context

No new use case needed — debug is a **command-level** concern, not a domain concern. The slice is a normal quick slice; the debug workflow is orchestrated by the skill.

#### Command handler

```
/tff:debug [bug description] [--complexity S|F-lite|F-full]
```

---

### 3. `/tff:health` — State Consistency Check

#### Extended HealthCheckService

Current checks (4):
- `ensurePostCheckoutHook()` → auto-fix
- `ensureGitignore()` → auto-fix
- `cleanStaleLocks()` → auto-fix
- `checkOrphanedState()` → warning

New checks (3):

##### Orphaned Worktrees
- Call `WorktreePort.list()` → get active worktree paths
- Cross-reference with slices in status ∈ {discussing, researching, planning, executing, verifying, reviewing}
- Worktree without matching active slice → orphaned (warning)
- Active slice without worktree → missing worktree (warning)

##### Journal/SQLite Drift Detection
Full journal replay approach:

1. For each active slice with journal entries:
   - Read journal via `JournalRepositoryPort.readAll(sliceId)`
   - Count `task-completed` entries → `journalCompletedCount`
   - Query `TaskRepositoryPort.findBySliceId(sliceId)` → count tasks with status `completed` → `sqliteCompletedCount`
   - `journalCompletedCount ≠ sqliteCompletedCount` → drift detected (warning with counts)
2. Cross-validate: every `task-completed` journal entry has a matching completed task in SQLite
3. Cross-validate: every `checkpoint-saved` entry's `completedTaskCount` is ≤ actual completed tasks

##### Missing Artifacts
Per-status required artifact check:

| Slice Status | Required Artifacts |
|---|---|
| researching+ | SPEC.md |
| planning+ | SPEC.md, RESEARCH.md (unless S-tier) |
| executing+ | SPEC.md, PLAN.md |
| verifying+ | SPEC.md, PLAN.md |

- Check via `ArtifactFilePort.exists()` for each required artifact
- Missing → warning with slice label + missing artifact name

#### HealthCheckReport extension

```typescript
interface HealthCheckReport {
  fixed: string[];
  warnings: string[];
  driftDetails: DriftDetail[];    // new
}

interface DriftDetail {
  sliceId: string;
  sliceLabel: string;
  journalCompleted: number;
  sqliteCompleted: number;
  missingInSqlite: string[];     // taskIds in journal but not completed in SQLite
  missingInJournal: string[];    // taskIds completed in SQLite but not in journal
}
```

#### New dependencies for HealthCheckService

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

#### Command handler

```
/tff:health
```

Runs `HealthCheckService.runAll()`, formats report as markdown table, sends via `sendUserMessage()`.

#### Tool

`tff_health_check` — AI-callable, returns structured `HealthCheckReport` JSON.

---

### 4. `/tff:progress` — Dashboard + STATE.md Autofix

#### RegenerateStateMdUseCase

Reads current domain state, produces STATE.md content, writes it to `.tff/STATE.md`.

```typescript
interface RegenerateStateMdInput {
  tffDir: string;
}

interface RegenerateStateMdOutput {
  stateContent: string;     // markdown content written to STATE.md
  wasStale: boolean;        // true if content differed from existing STATE.md
}
```

#### Flow

1. Load project, active milestone, all slices, all tasks via repos
2. Compute progress: completed/total for slices and tasks
3. Build markdown table matching current STATE.md format:
   - Progress summary
   - Slice table (label, status, task count, progress %)
4. Read existing STATE.md (if any)
5. Compare content — if different, write updated STATE.md
6. Return both the content and whether it was stale

#### Dashboard content

The command returns a formatted dashboard for the skill to display:

```
# Progress — M07: Team Collaboration, Polish & Platform Commands

## Summary
- Slices: 6/10 completed (60%)
- Tasks: 15/31 completed (48%)

## Slices
| Slice | Status | Tasks | Progress |
|---|---|---|---|
| Infrastructure Reorg | closed | 6/6 | 100% |
| State Branch CRUD | closed | 15/15 | 100% |
| ... | ... | ... | ... |

STATE.md: ✓ up-to-date (or: ⚠ auto-fixed — was stale)
```

#### Command handler

```
/tff:progress
```

Runs `RegenerateStateMdUseCase`, sends dashboard content via `sendUserMessage()`.

#### Tool

`tff_progress` — AI-callable, returns dashboard string + stale flag.

---

### 5. `/tff:settings` — View Settings Cascade

#### Read flow

Uses existing `LoadSettingsUseCase` + `MergeSettingsUseCase`:

1. `LoadSettingsUseCase.execute(projectRoot)` → raw sources (team, local, env)
2. `MergeSettingsUseCase.execute(sources)` → merged `ProjectSettings`
3. Format as cascade view showing:
   - Each setting's final (active) value
   - Source indicator: `[team]`, `[local]`, `[env]`, `[default]`

#### Cascade display format

```
# Settings — Active Configuration

## Model Routing
| Setting | Value | Source |
|---|---|---|
| quality.model | opus | [default] |
| balanced.model | sonnet | [default] |
| budget.model | sonnet | [default] |
| S → | budget | [default] |
| F-lite → | balanced | [default] |
| F-full → | quality | [default] |

## Autonomy
| Setting | Value | Source |
|---|---|---|
| mode | guided | [default] |
| maxRetries | 2 | [default] |

... (all sections)
```

#### Source attribution

To show which layer provided each value, compare team-only merge, local-only merge, and env-only merge against the final merged result. If value matches env → `[env]`; else if matches local → `[local]`; else if matches team → `[team]`; else → `[default]`.

#### FormatSettingsCascadeService

Pure formatting service. Takes `ProjectSettings` + `RawSettingsSources` → produces cascade markdown.

#### Command handler

```
/tff:settings
```

Loads + merges + formats → sends via `sendUserMessage()`.

#### Tool

`tff_read_settings` — AI-callable, returns structured settings JSON with source annotations.

`tff_update_setting` — AI-callable, writes a single key-value to `.tff/settings.yaml`. Takes `{ key: string, value: unknown }` where key is dot-path (e.g., `autonomy.mode`). Reads existing YAML, deep-sets the key, writes back.

---

### 6. `/tff:help` — Command Reference

#### Runtime command discovery

Uses `api.getCommands()` (existing on `ExtensionAPI`) which returns `SlashCommandInfo[]` — all registered commands with names and descriptions.

#### Command handler

```
/tff:help
```

1. Call `api.getCommands()`
2. Filter to `tff:*` commands
3. Format as markdown table:

```
# TFF Command Reference

| Command | Description |
|---|---|
| /tff:discuss | Start the discuss phase for a slice |
| /tff:research | Start the research phase for a slice |
| /tff:plan | Start the plan phase for a slice |
| /tff:quick | Quick-start a slice (skip discuss + research) |
| /tff:debug | Open a debugging slice |
| /tff:health | Run state consistency checks |
| /tff:progress | Show project dashboard |
| /tff:settings | View settings cascade |
| /tff:sync | Force push/pull state branch |
| /tff:status | Show project status |
| /tff:help | This command reference |
| ... | ... |
```

4. Send via `sendUserMessage()`

No tool needed — help is a display-only command.

---

### Extension Wiring (extension.ts)

All new use cases, commands, and tools wired in `registerRootExtension()`:

```
New instantiations:
  - QuickStartUseCase(sliceRepo, milestoneRepo, startDiscuss, sessionRepo, dateProvider, autonomyProvider)
  - RegenerateStateMdUseCase(projectRepo, milestoneRepo, sliceRepo, taskRepo, artifactFile)
  - FormatSettingsCascadeService()
  - LoadSettingsUseCase(filePort, envPort)

New commands:
  - tff:quick    → QuickStartUseCase + protocol message
  - tff:debug    → QuickStartUseCase + debug protocol message
  - tff:health   → HealthCheckService.runAll() + format
  - tff:progress → RegenerateStateMdUseCase + format
  - tff:settings → LoadSettings + MergeSettings + format
  - tff:help     → api.getCommands() + format

New tools:
  - tff_quick_start     → QuickStartUseCase
  - tff_health_check    → HealthCheckService
  - tff_progress        → RegenerateStateMdUseCase
  - tff_read_settings   → LoadSettings + MergeSettings
  - tff_update_setting  → write to settings.yaml
```

### New Files

```
workflow/use-cases/quick-start.use-case.ts
workflow/use-cases/quick-start.use-case.spec.ts
workflow/use-cases/regenerate-state-md.use-case.ts
workflow/use-cases/regenerate-state-md.use-case.spec.ts
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

### Modified Files

```
kernel/services/health-check.service.ts              — 3 new checks, extended deps, DriftDetail
kernel/services/health-check.service.spec.ts          — tests for new checks
cli/extension.ts                                       — wire all new commands + tools
cli/extension.spec.ts                                  — update registration assertions
workflow/infrastructure/pi/workflow.extension.ts        — export QuickStartUseCase deps
workflow/infrastructure/pi/workflow.extension.spec.ts   — update assertions
```

## Acceptance Criteria

- **AC1:** `/tff:quick` creates slice in active milestone, auto-transitions to planning (any complexity) or executing (S-tier + plan-to-pr), sends protocol message with slice context
- **AC2:** `/tff:debug` creates quick-start slice, sends debug protocol message with systematic-debugging skill reference and 4-phase structure
- **AC3:** `/tff:health` detects orphaned worktrees (worktree without active slice / active slice without worktree), journal/SQLite drift (via full journal replay + cross-validation), and missing artifacts (per-status required artifacts)
- **AC4:** `/tff:progress` renders readable dashboard with slice/task completion stats. Auto-regenerates STATE.md if stale
- **AC5:** `/tff:settings` shows settings cascade with source attribution ([default], [team], [local], [env]) for every active value
- **AC6:** `/tff:help` discovers commands at runtime via `api.getCommands()`, filters to `tff:*`, renders markdown table
- **AC7:** All commands respect autonomy mode — `/tff:quick` S-tier auto-approves plan only in plan-to-pr mode

## Non-Goals

- Cost/budget tracking in progress dashboard (no budget infrastructure yet)
- Interactive settings editor / TUI
- Debug-specific domain model (debug is a command concern, not a domain concept)
- Bulk artifact migration on health check (report only, no auto-fix for missing artifacts)
- Settings schema migration on write

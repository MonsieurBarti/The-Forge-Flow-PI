# Research — M07-S08: Platform Commands Batch 1 (Daily Use)

## R1: QuickStartUseCase Composition

### Transition Table Analysis

Relevant rules (`transition-table.ts:19-45`):
- `idle → discussing` via `start` (no guard)
- `discussing → planning` via `skip` (no guard, no effects)
- `planning → executing` via `approve` (no guard, `resetRetryCount` effect)

The `skip` trigger already exists and bypasses research. No domain model changes needed.

### Autonomy Policy Interaction

From `autonomy-policy.ts`:
- **guided**: all active phases are human gates
- **plan-to-pr**: `planning`, `reviewing`, `shipping` are gates — everything else auto-transitions

**Problem:** Planning is a gate in BOTH modes. For S-tier quick + plan-to-pr, we want to auto-approve. This requires `QuickStartUseCase` to explicitly trigger `approve` — overriding the normal gate behavior. This is intentional: quick is designed to skip ceremony.

**Decision matrix confirmed:**

| Complexity | Autonomy | Auto-approve plan? | Final phase |
|---|---|---|---|
| S | plan-to-pr | yes | executing |
| S | guided | no | planning (gate) |
| F-lite/F-full | any | no | planning (gate) |

### StartDiscussUseCase Composition

`StartDiscussUseCase.execute()` does 7 things:
1. Validates slice exists
2. Creates workspace (worktree + state branch) if ports available
3. Finds or creates `WorkflowSession`
4. Assigns slice to session
5. Triggers `start` (idle → discussing)
6. Persists session
7. Publishes domain events

QuickStartUseCase composes this, then:
1. Triggers `skip` (discussing → planning)
2. Transitions slice status to `planning`
3. Conditionally triggers `approve` (planning → executing) for S-tier + plan-to-pr
4. Persists session again
5. Publishes events

### Slice Label Generation

Labels are externally provided (`Slice.createNew({ label })`) — no auto-generation exists. For quick slices, the command handler must compute the next available label by querying existing slices in the milestone.

**Approach:** Query `sliceRepo.findByMilestoneId()`, find max label number, increment. Use same `M07-Sxx` format (not a separate `Qxx` scheme) to maintain consistency.

### OrchestratePhaseTransitionUseCase

Alternative to manual triggers: call `OrchestratePhaseTransitionUseCase.execute()` for each transition. It handles:
- Session loading
- Trigger execution
- Slice status mapping (`phase-status-mapping.ts`)
- Event publishing

**Recommendation:** Use `OrchestratePhaseTransitionUseCase` for skip + approve transitions rather than manually calling `session.trigger()`. This keeps slice status in sync automatically.

---

## R2: HealthCheckService Extension

### Port Availability

All needed ports exist with sufficient methods:

| Check | Port | Method | Returns | Adapter |
|---|---|---|---|---|
| Orphaned worktrees | `WorktreePort` | `list()` | `WorktreeInfo[]` | `GitWorktreeAdapter` |
| Orphaned worktrees | `SliceRepositoryPort` | `findById()` | `Slice \| null` | `SqliteSliceRepository` |
| Journal drift | `JournalRepositoryPort` | `readAll(sliceId)` | `JournalEntry[]` | `JsonlJournalRepository` |
| Journal drift | `TaskRepositoryPort` | `findBySliceId()` | `Task[]` | `SqliteTaskRepository` |
| Missing artifacts | `ArtifactFilePort` | `read(msLabel, sliceLabel, type)` | `string \| null` | `NodeArtifactFileAdapter` |

No new port methods required.

### Journal Repository Caveat

**Critical:** CLI extension (`extension.ts:176`) uses `InMemoryJournalRepository` (ephemeral). The persistent `JsonlJournalRepository` requires a base path for JSONL files.

For health check drift detection, `HealthCheckService` needs a `JsonlJournalRepository` instance. Must instantiate it in `extension.ts` with base path `.tff/milestones/{milestoneLabel}/`.

**Problem:** Journal files are per-slice at `.tff/milestones/M##/{sliceId}.jsonl`. The `JsonlJournalRepository` constructor takes a `basePath`. Each milestone has its own journal directory.

**Solution:** Pass `JsonlJournalRepository` with `rootTffDir` as base — it constructs paths as `${basePath}/${sliceId}.jsonl`. Check actual constructor to confirm path scheme.

### Task Status Semantics

`GetStatusUseCase` (`get-status.use-case.ts:95`) counts completed tasks via `status === "closed"`. Journal entries use `type: "task-completed"`. Both refer to the same semantic state — a task that finished successfully.

### Active Slice Statuses for Worktree Cross-Reference

Slices that should have a worktree (I4: discuss → ship):
```
discussing, researching, planning, executing, verifying, reviewing
```

Slices that should NOT have a worktree:
```
completing, closed
```

### Artifact Requirements by Status

From the SPEC's artifact table, refined after checking domain:

| Slice Status | Required | Optional |
|---|---|---|
| discussing | — | SPEC.md (in progress) |
| researching | SPEC.md | RESEARCH.md (in progress) |
| planning | SPEC.md | RESEARCH.md, PLAN.md (in progress) |
| executing+ | SPEC.md, PLAN.md | RESEARCH.md, CHECKPOINT.md |

S-tier slices skip research, so RESEARCH.md is never required for them. Check `slice.complexity === "S"` before flagging missing RESEARCH.md.

---

## R3: Settings Cascade Source Attribution

### Merge Order

`MergeSettingsUseCase` (`merge-settings.use-case.ts:19-28`):
```
{} → team → local → env → Zod defaults
```

Last write wins. Arrays replace (no concat). Objects deep-merge.

### Source Attribution Strategy

To attribute each leaf value to its source:

1. Merge team-only: `ProjectSettings.create(team ?? {})`
2. Merge team+local: `ProjectSettings.create(deepMerge(team, local))`
3. Final merge: full cascade result

For each leaf path in final settings:
- If value present in `env` source → `[env]`
- Else if value in `local` differs from team-only → `[local]`
- Else if value in `team` differs from defaults → `[team]`
- Else → `[default]`

**Implementation:** Walk the settings object recursively, comparing leaf values at each level against each source layer.

### Limitation

Cannot distinguish "explicitly set to default value" from "inherited default". Acceptable — source attribution shows the effective source, not user intent.

### Settings Write

`SettingsFilePort` is **read-only** (no write method). For `tff_update_setting` tool:
- Read existing `.tff/settings.yaml` via `fs.readFileSync`
- Parse YAML → object
- Deep-set the target key
- Serialize back to YAML
- Write via `fs.writeFileSync`

Use `yaml` package (already a dependency) for parse/stringify.

### Missing Getters

`ProjectSettings` value object is missing getters for `guardrails` and `overseer`. These are accessible via `toJSON()` but not via typed getters. For settings display, use `toJSON()` which returns all 7 domains.

---

## R4: STATE.md Regeneration

### Current Format

```markdown
# State — {Milestone Title}

## Progress
- Slices: X/Y completed
- Tasks: X/Y completed

## Slices
| Slice | Status | Tasks | Progress |
|---|---|---|---|
| {title} | {status} | {completed}/{total} | {pct}% |
```

### Data Source

`GetStatusUseCase.execute()` returns `StatusReport` with:
- `project: { name, vision } | null`
- `activeMilestone: { label, title, status } | null`
- `slices: [{ label, title, status, complexity, taskCount, completedTaskCount }]`
- `totals: { totalSlices, completedSlices, totalTasks, completedTasks }`

This provides everything needed for STATE.md. Progress % = `(completedTaskCount / taskCount) * 100`.

### Staleness Detection

Compare generated markdown string with existing STATE.md content. If different → write + report stale. Simple string comparison is sufficient (format is deterministic).

### Writing STATE.md

Use `NodeArtifactFileAdapter` pattern or direct `fs.writeFileSync` to `.tff/STATE.md`. The `ArtifactFilePort` writes to `.tff/milestones/` subtree, not to `.tff/STATE.md` directly. Direct filesystem write is appropriate here.

---

## R5: Help Command — api.getCommands()

### ExtensionAPI.getCommands()

Available on `ExtensionAPI` (`pi-coding-agent types.d.ts:789`):
```typescript
getCommands(): SlashCommandInfo[];
```

Returns all registered slash commands in the current session, including those from other extensions.

### SlashCommandInfo Type

```typescript
interface SlashCommandInfo {
  name: string;
  description?: string;
  source?: SlashCommandSource;
}
```

### Filtering Strategy

Filter by `name.startsWith("tff:")` to show only TFF commands. Sort alphabetically for consistent output.

### Timing

`api.getCommands()` returns commands registered at call time. Since the help command handler runs after all extensions are loaded, it will see all registered commands.

---

## R6: Extension Wiring — Impact Assessment

### New Dependencies in extension.ts

```
New instantiations needed:
  - JsonlJournalRepository(basePath)     — for health check drift detection
  - QuickStartUseCase(...)               — for quick + debug commands
  - RegenerateStateMdUseCase(...)        — for progress command
  - FormatSettingsCascadeService()       — for settings command
  - LoadSettingsUseCase(filePort, envPort) — may already exist partially
```

### Existing Available Deps

Already instantiated in `extension.ts`:
- `sliceRepo` (SqliteSliceRepository) — line 154
- `taskRepo` (SqliteTaskRepository) — line 155
- `milestoneRepo` (SqliteMilestoneRepository) — line 153
- `projectRepo` (SqliteProjectRepository) — line 152
- `artifactFile` (NodeArtifactFileAdapter) — line 161
- `worktreeAdapter` (GitWorktreeAdapter) — line 140
- `healthCheckService` (HealthCheckService) — line 397
- `stateGuard` (StateGuard) — line 412
- `withGuard` function — line 414
- `startDiscuss` (StartDiscussUseCase) — inside registerWorkflowExtension

### Placement Decision

Two options for new command/tool registration:
1. **In extension.ts directly** (like tff:sync) — simpler, no new extension functions
2. **In workflow.extension.ts** (like tff:discuss) — follows hexagonal boundaries

**Recommendation:** Register `tff:quick`, `tff:debug` in workflow extension (they manage workflow state). Register `tff:health`, `tff:progress`, `tff:settings`, `tff:help` in extension.ts (cross-cutting, not owned by a single hexagon).

### Test Pattern

From `extension.spec.ts`:
```typescript
const commandNames = fns.registerCommand.mock.calls.map(call => call[0]);
expect(commandNames).toContain("tff:quick");
```

Update count assertions for both commands and tools.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Journal base path mismatch | Health check reads wrong directory | Verify JsonlJournalRepository path construction against actual file layout |
| S-tier auto-approve bypasses plan review | Potentially dangerous in some projects | Only for quick command + plan-to-pr mode; guided mode always gates |
| Settings write corrupts YAML | Broken settings | Read → parse → modify → serialize → write. Validate with Zod before writing. |
| api.getCommands() includes non-TFF commands | Help lists irrelevant commands | Filter by `tff:` prefix |
| InMemoryJournalRepository in CLI | Health check drift always reports clean | Use separate JsonlJournalRepository instance |

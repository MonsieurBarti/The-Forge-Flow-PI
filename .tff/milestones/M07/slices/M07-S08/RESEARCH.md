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

### OrchestratePhaseTransitionUseCase

Alternative to manual triggers: call `OrchestratePhaseTransitionUseCase.execute()` for each transition. It handles:
- Session loading
- Trigger execution
- Slice status mapping (`phase-status-mapping.ts`)
- Event publishing

**Recommendation:** Use `OrchestratePhaseTransitionUseCase` for skip + approve transitions rather than manually calling `session.trigger()`. This keeps slice status in sync automatically.

---

## R2: Quick/Debug Lifecycle — Domain Model Constraint Analysis

### Current Architecture: Everything is Milestone-Bound

Investigation reveals the entire domain model hard-couples slices to milestones at **every layer**:

| Layer | Constraint | Location |
|---|---|---|
| Schema | `milestoneId: IdSchema` (required) | `slice.schemas.ts:59` |
| Label validation | `/^M\d{2,}-S\d{2,}$/` — milestone prefix mandatory | `slice.schemas.ts:17` |
| Aggregate | `Slice.createNew({ milestoneId })` — required param | `slice.aggregate.ts:69` |
| SQLite | `milestone_id TEXT NOT NULL` | `sqlite-slice.repository.ts:29` |
| Repository | `findByMilestoneId()` only — no findAll/findOrphans | `slice-repository.port.ts:8` |
| WorkflowSession | `milestoneId: string` — required | `workflow-session.aggregate.ts:74` |
| StartDiscussUseCase | `milestoneId: string` in input — required | `start-discuss.use-case.ts:24` |
| Artifact paths | `.tff/milestones/{msLabel}/slices/{sliceLabel}/` | `node-artifact-file.adapter.ts:19-35` |
| Worktree adapter | `baseBranchFor()` derives milestone from `sliceId.split("-")[0]` | `git-worktree.adapter.ts:29-32` |
| State branches | `tff-state/slice/{M##-S##}` — milestone-scoped | `start-discuss.use-case.ts:138` |
| GetStatusUseCase | Queries only `sliceRepo.findByMilestoneId()` | `get-status.use-case.ts:81` |

### Design Options

#### Option A: Full Decoupling (make milestoneId optional everywhere)

Changes required:
- `SlicePropsSchema` → `milestoneId` optional
- `SliceLabelSchema` → relax regex to allow `Q-xxx`, `DBG-xxx`
- `Slice.createNew()` → milestoneId optional
- SQLite schema → `milestone_id TEXT` (nullable) + migration
- `SliceRepositoryPort` → add `findByType()`, `findAll()`
- `WorkflowSession` → milestoneId optional or new `QuickSession`
- `StartDiscussUseCase` → milestoneId optional path
- `NodeArtifactFileAdapter` → new path scheme for `.tff/quick/`, `.tff/debug/`
- `GitWorktreeAdapter.baseBranchFor()` → handle non-milestone IDs
- State branch naming → `tff-state/quick/<id>`
- `GetStatusUseCase` → exclude quick/debug from milestone reporting

**Verdict:** ~15 file changes across 4 hexagons + kernel. High risk of breaking existing milestone flow. Touches core domain invariants.

#### Option B: Lightweight Synthetic Milestone

Create a persistent `_adhoc` milestone on project init. Quick/debug slices belong to it.
- Labels remain `M00-S01` etc. (valid per existing schema)
- All existing infrastructure works unchanged
- Artifacts at `.tff/milestones/M00/slices/M00-S01/`

**Verdict:** Minimal code changes but violates the explicit requirement that quick/debug are "NOT correlated to milestones" with own artifact paths (`.tff/quick/<id>/`).

#### Option C: Parallel Aggregate (`QuickTask`)

New aggregate separate from `Slice`:
- Own schema, repo, table, label scheme
- Simplified lifecycle (no full ceremony)
- Own artifact path (`.tff/quick/<id>/`)
- Can reuse `WorktreePort` but with different naming
- Doesn't need `WorkflowSession`

**Verdict:** Clean separation but significant new infrastructure. Duplicates slice-like behavior.

#### Option D: Thin `AdHocTask` aggregate + reuse infrastructure via ports

Hybrid — new aggregate with minimal fields, but delegate to existing ports where possible:
- `AdHocTask` aggregate: `{ id, type: "quick"|"debug", title, description, complexity, status, createdAt }`
- Own repo (`AdHocTaskRepositoryPort` + `SqliteAdHocTaskRepository`)
- Own artifact adapter (path: `.tff/quick/<id>/` or `.tff/debug/<id>/`)
- Reuse `WorktreePort` (pass task ID as sliceId param — it's just a string)
- Reuse state branch infra (`tff-state/quick/<id>`)
- Own simplified state machine (no full workflow ceremony — just `planning → executing → closed`)
- No `WorkflowSession` dependency

**Verdict:** Cleanest separation. New aggregate is small (~50 lines). Own repo + table is straightforward. Reuses worktree/state-branch infra via existing ports. Doesn't touch milestone-bound code at all.

### Recommendation: Option D

Option D satisfies the requirements:
- ∀ quick/debug task: NOT coupled to any milestone
- Artifact paths: `.tff/quick/<id>/`, `.tff/debug/<id>/`
- State branches: `tff-state/quick/<id>`, `tff-state/debug/<id>`
- Worktrees: `.tff/worktrees/<id>` (reuse existing port)
- Zero changes to existing Slice/Milestone domain model
- Simplified lifecycle — no discuss/research ceremony

**However:** This is a non-trivial addition to S08. New aggregate + repo + table + adapter + use case. It may warrant splitting quick/debug into a separate slice (pre-S08) or accepting the scope increase.

### Worktree Adapter Impact

`GitWorktreeAdapter.baseBranchFor()` (line 29-32) derives milestone from `sliceId.split("-")[0]`. For ad-hoc tasks, `baseBranch` would be `main` or the current branch — not a milestone branch. The `create()` method already accepts `baseBranch` as an explicit parameter, so `baseBranchFor()` is only used in `list()` and `validate()`. These would need to handle non-milestone IDs gracefully (fallback to `main`).

### State Branch Parent Resolution

`fresh-clone.strategy.ts` uses regex patterns to resolve parent state branches:
```
slice/M##-S## → tff-state/milestone/M##
milestone/M## → tff-state/main
```

For quick/debug, add:
```
quick/<id> → tff-state/main
debug/<id> → tff-state/main
```

---

## R3: HealthCheckService Extension

### Port Availability

All needed ports exist with sufficient methods:

| Check | Port | Method | Returns | Adapter |
|---|---|---|---|---|
| Orphaned worktrees | `WorktreePort` | `list()` | `WorktreeInfo[]` | `GitWorktreeAdapter` |
| Orphaned worktrees | `SliceRepositoryPort` | `findById()` | `Slice \| null` | `SqliteSliceRepository` |
| Journal drift | `JournalRepositoryPort` | `readAll(sliceId)` | `JournalEntry[]` | `JsonlJournalRepository` |
| Journal drift | `TaskRepositoryPort` | `findBySliceId()` | `Task[]` | `SqliteTaskRepository` |
| Missing artifacts | `ArtifactFilePort` | `read(msLabel, sliceLabel, type)` | `string \| null` | `NodeArtifactFileAdapter` |

No new port methods required. Use `read() !== null` as existence check (no `exists()` method on `ArtifactFilePort`).

### Journal Repository

CLI extension (`extension.ts`) now wires `JsonlJournalRepository` with base path `join(rootTffDir, "journal")`. Journal files are per-slice at `{basePath}/{sliceId}.jsonl`.

### Task Status Semantics

`GetStatusUseCase` counts completed tasks via `status === "closed"`. Journal entries use `type: "task-completed"`. Both refer to the same semantic state.

### Active Slice Statuses for Worktree Cross-Reference

Slices that should have a worktree (I4: discuss → ship):
```
discussing, researching, planning, executing, verifying, reviewing
```

Slices that should NOT:
```
completing, closed
```

### Artifact Requirements by Status

| Slice Status | Required | Exception |
|---|---|---|
| discussing | — | — |
| researching | SPEC.md | — |
| planning | SPEC.md | RESEARCH.md not required if S-tier |
| executing+ | SPEC.md, PLAN.md | RESEARCH.md not required if S-tier |

---

## R4: Progress Command — No New Use Case Needed

### GetStatusUseCase Already Provides Everything

`GetStatusUseCase.execute()` returns `StatusReport` with:
- `project: { name, vision } | null`
- `activeMilestone: { label, title, status } | null`
- `slices: [{ label, title, status, complexity, taskCount, completedTaskCount }]`
- `totals: { totalSlices, completedSlices, totalTasks, completedTasks }`

This is exactly what STATE.md contains. No new use case needed.

### Progress Command Flow (command-level only)

1. Call `GetStatusUseCase.execute()`
2. Format `StatusReport` → markdown (pure function, ~30 lines)
3. Read existing `.tff/STATE.md`
4. Compare strings — if different, write updated STATE.md
5. Send dashboard via `sendUserMessage()`

The "RegenerateStateMdUseCase" from the original spec is redundant. File I/O + formatting is a command concern, not domain logic.

### Writing STATE.md

`ArtifactFilePort` writes to `.tff/milestones/` subtree only. STATE.md lives at `.tff/STATE.md`. Direct `fs.writeFileSync` is appropriate — same pattern used by `branch-meta.json` writes.

---

## R5: Settings Cascade Source Attribution

### Merge Order

`MergeSettingsUseCase` (`merge-settings.use-case.ts:19-28`):
```
{} → team → local → env → Zod defaults
```

Last write wins. Arrays replace (no concat). Objects deep-merge.

### Source Attribution Strategy

For each leaf path in final settings:
- If value present in `env` source → `[env]`
- Else if value in `local` differs from team-only → `[local]`
- Else if value in `team` differs from defaults → `[team]`
- Else → `[default]`

Walk settings object recursively, comparing leaf values at each source layer.

### Settings Write

`SettingsFilePort` is **read-only** (no write method). For `tff_update_setting` tool:
- Read existing `.tff/settings.yaml` via `fs.readFileSync`
- Parse YAML → deep-set target key → serialize → write
- Validate through Zod after write to catch invalid values
- `yaml` package (^2.8.3) already in dependencies

---

## R6: Help Command — api.getCommands()

`ExtensionAPI.getCommands()` returns `SlashCommandInfo[]`:
```typescript
interface SlashCommandInfo {
  name: string;
  description?: string;
  source?: SlashCommandSource;
}
```

Filter by `name.startsWith("tff:")`. Sort alphabetically. Available after all extensions loaded.

---

## R7: Extension Wiring — Impact Assessment

### Placement Decision

| Command | Register in | Reason |
|---|---|---|
| `tff:quick` | workflow extension | Manages workflow state |
| `tff:debug` | workflow extension | Same as quick |
| `tff:health` | extension.ts | Cross-cutting (kernel service) |
| `tff:progress` | extension.ts | Cross-cutting (status across hexagons) |
| `tff:settings` | extension.ts | Settings hexagon access |
| `tff:help` | extension.ts | Cross-cutting (all commands) |

### Existing Deps Available in extension.ts

Already instantiated: `projectRepo`, `milestoneRepo`, `sliceRepo`, `taskRepo`, `artifactFile`, `worktreeAdapter`, `healthCheckService`, `stateGuard`, `journalRepo`.

### Test Pattern

```typescript
const commandNames = fns.registerCommand.mock.calls.map(call => call[0]);
expect(commandNames).toContain("tff:quick");
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Quick/debug lifecycle adds scope to S08 | Slice may be too large | Consider splitting: ad-hoc task infra as separate pre-S08 slice |
| `baseBranchFor()` assumes milestone-scoped IDs | Worktree list/validate breaks for ad-hoc tasks | Fallback to `main` when ID doesn't match `M##-S##` pattern |
| State branch parent resolution hardcoded to milestone pattern | Fresh-clone fails for quick/debug branches | Add `quick/<id>` and `debug/<id>` patterns to resolver |
| Journal base path mismatch | Health check reads wrong directory | Verify `JsonlJournalRepository` path construction |
| Settings write corrupts YAML | Broken settings | Read → parse → modify → Zod validate → serialize → write |
| S-tier auto-approve bypasses plan review | Dangerous in some contexts | Only for quick command + plan-to-pr mode |

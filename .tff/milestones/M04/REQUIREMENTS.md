# M04: Execution and Recovery

## Goal

Build the execution engine with wave-based parallel dispatch, checkpoint/resume for crash recovery, cost tracking, and agent safety mechanisms.

## Requirements

### R01: Execution Hexagon -- Checkpoint Entity

- `Checkpoint` aggregate with `CheckpointPropsSchema` (id, sliceId, baseCommit, currentWaveIndex, completedWaves, completedTasks, executorLog, timestamps)
- `recordTaskStart()`, `recordTaskComplete()`, `advanceWave()`, `isTaskCompleted()`, `isWaveCompleted()` business methods
- Storage: `.tff/milestones/<M0X>/slices/<slice-id>/CHECKPOINT.md` (human-readable header + JSON in HTML comment)
- `CheckpointRepositoryPort`, SQLite + in-memory adapters

**AC:**
- Per-task checkpoint save (after each task completes)
- Per-wave checkpoint save (before each wave starts)
- Checkpoint data is recoverable from CHECKPOINT.md HTML comment

### R02: Wave-Based Parallel Dispatch

- `ExecuteSliceUseCase`: load slice + tasks -> detect waves -> load/create checkpoint -> dispatch
- For each wave (sequential): dispatch tasks in parallel via `AgentDispatchPort`, checkpoint after each completion
- Fresh subagent per task via PI SDK's `createAgentSession()`
- Domain routing: file paths determine which skills to load
  - `src/domain/`, `src/application/`, `src/infrastructure/` -> hexagonal-architecture
  - Baseline for all tasks: executing-plans + commit-conventions
- Emit `AllTasksCompletedEvent` when all waves complete
- Stale claim detection: TTL 30 minutes, checked before each wave

**AC:**
- Tasks within a wave execute in parallel
- Waves execute sequentially
- Domain routing correctly maps file paths to skills
- Stale claims detected and reported

### R03: Agent Dispatch Port + PI Adapter

- `AgentDispatchPort` abstract class (dispatch, abort)
- `AgentDispatchConfigSchema`: taskId, sliceId, workingDirectory, systemPrompt, taskPrompt, model, tools, filePaths
- `AgentResultSchema`: taskId, success, output, filesChanged, cost, agentIdentity, durationMs, error
- `PiAgentDispatchAdapter`: creates fresh PI session per task
- Concurrency model: orchestrator owns SQLite connection, agents run in worktrees, never write to SQLite directly

**AC:**
- Each agent gets a fresh context window (no bleed between tasks)
- Agent results include cost tracking data
- Abort signal supported for cancellation

### R04: Worktree Management

- `WorktreePort` abstract class (create, delete, list, exists)
- One worktree per slice at `.tff/worktrees/<slice-id>/` on branch `slice/<slice-id>`
- S-tier: no worktree needed (runs in main repo)
- F-lite/F-full: worktree required (blocks if missing)
- Created during plan phase, deleted during ship phase after PR merge
- Lifecycle: created per-slice (not per-task)

**AC:**
- Worktree creation and deletion tested
- Missing worktree for F-lite/F-full produces clear error

### R05: Crash Recovery

- Journal: append-only JSONL in `.tff/journal.jsonl`
- `JournalEntrySchema`: discriminated union (task-started, task-completed, task-failed, file-written, checkpoint-saved, phase-changed, artifact-written)
- Journal replay is idempotent (entries describe facts, not mutations)
- On resume: skip completed waves, skip completed tasks in current wave, retry remaining
- Rollback: identify execution commits after baseCommit, revert in reverse order

**AC:**
- Journal survives agent crashes
- Resume correctly skips completed work
- Rollback only reverts code commits (not artifact commits)

### R06: Cost Tracking

- `CostEntrySchema`: taskId, sliceId, milestoneId, provider, modelId, inputTokens, outputTokens, cost, timestamp
- Accumulated per-task, per-slice, per-milestone
- Stored in `.tff/metrics.json`

**AC:**
- Cost data captured from every agent dispatch
- Queryable by slice and milestone

### R07: Async Overseer / Watchdog

- Lightweight monitor for stuck agent detection
- Configurable timeout per task (default based on complexity tier)
- Detects: infinite retry loops, stagnation (no progress for N minutes), runaway token usage
- On detection: abort agent, log structured error, escalate to orchestrator

**AC:**
- Stuck agents are killed after timeout
- Infinite retry loops detected and broken
- Structured error log per timeout event

### R08: Output Safety Guardrails

- Pre-apply validation of agent-generated filesystem changes
- Check for dangerous patterns: `rm -rf`, credential exposure, destructive git operations
- Validate output against expected file paths from task spec
- Block unexpected file modifications outside task scope

**AC:**
- Dangerous patterns detected and blocked before applying
- Unexpected file modifications flagged for human review

### R09: Agent Status Protocol

- All agents report using one of 4 statuses: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED
- Self-review checklist before reporting: Completeness, Quality, Discipline, Verification
- "Never silently produce work you're unsure about"

**AC:**
- Agent results include structured status (not free-form text)
- DONE_WITH_CONCERNS includes concerns list

### R10: Commands

- `/tff:execute` -- start wave-based task execution
- `/tff:pause` -- save execution checkpoint for later resume
- `/tff:resume` -- resume from saved checkpoint

**AC:**
- Execute dispatches tasks wave-by-wave with checkpointing
- Pause saves state and can resume from exact point
- Resume skips completed work

### R11: Per-Task Reflection (Design Improvement A)

- After each task completes successfully, the same agent re-reads its diff and checks output against acceptance criteria
- `ReflectionResultSchema`: passed, issues (criterion, concern, severity: blocker/warning), reflectedAt
- Extends `AgentResultSchema` with optional `reflection` field
- Reflection.passed -> record success; blockers -> retry (counts toward maxRetries); warnings -> record success with warnings
- Reflection uses same agent session (second turn, no extra dispatch)
- Max 1 reflection per task (no loops)

**AC:**
- Blockers caught before subsequent tasks build on flawed output
- Reflection retry counts toward fallback chain
- No extra agent dispatch cost (same session)

### R12: Model Downshift Fallback Chain (Design Improvement B)

- 3-step recovery chain: retry same model (1x) -> downshift to cheaper (1x) -> escalate
- `FallbackStrategySchema`: retryCount (default 1, max 3), downshiftChain (quality -> balanced -> budget), checkpointBeforeRetry (default true)
- Added to `SettingsSchema.autonomy.fallbackStrategy`
- Checkpoint saved before each retry to prevent state loss
- Total attempts capped at `retryCount + len(downshiftChain)`
- Independent from `autonomy.maxRetries` (workflow-level re-execution cap)

**AC:**
- Checkpoint saved before any retry
- Downshift chain configurable in settings
- Total attempts bounded (no infinite loops)

### R13: Pre-Dispatch Guardrails (Design Improvement G -- pre-dispatch half)

- Extend existing post-dispatch guardrails with pre-dispatch validation
- Pre-dispatch checks: scope containment (task filePaths subset of slice scope), worktree state (correct branch, clean), no uncommitted changes, budget check (sufficient for estimated cost)
- Pre-dispatch blocker -> task not dispatched, escalate
- Configurable (individual checks can be disabled in settings)

**AC:**
- Out-of-scope tasks caught before dispatch (not after)
- Budget exhaustion detected before wasting tokens
- Pre-dispatch checks configurable per-project

### R14: Compressor Notation for Artifacts (Design Improvement I)

- All TFF-generated artifacts injected into agent context use formal logic notation
- Notation: `∀ ∃ ∈ ∧ ∨ ¬ → ⇒ ⟺ ⊆ |`
- Applies to: skills, agent definitions, plans, specs, research docs, task prompts
- Schemas and code blocks stay uncompressed
- ~40-60% token reduction vs verbose prose
- Injected into system prompt of artifact-generating agents (discuss, plan, research phases)

**AC:**
- Generated artifacts use compressed notation
- No information loss vs verbose originals
- Schemas/code uncompressed

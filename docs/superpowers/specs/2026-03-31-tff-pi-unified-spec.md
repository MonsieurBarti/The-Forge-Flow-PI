# The Forge Flow PI -- Unified Design Specification

> Consolidation of: `2026-03-25-tff-pi-design.md`, `2026-03-27-design-improvements.md`,
> `2026-03-28-per-branch-state-persistence.md`, `2026-03-31-tff-pi-gap-analysis.md`
>
> Date: 2026-03-31 | Status: Living document
>
> Legend: [BUILT] = implemented + tested | [PARTIAL] = schemas/ports exist, wiring incomplete | [PLANNED] = in milestone requirements | [NEW] = from gap analysis, not yet in milestones

---

## 1. Project Identity

**The Forge Flow PI (TFF-PI)** is a standalone CLI tool and PI extension that orchestrates AI agents through a structured software development lifecycle. Full port of TFF-CC rebuilt on PI SDK with strict hexagonal architecture.

### Goals

- Full feature parity with TFF-CC: milestones, slices, tasks, wave-based parallelism, skills, auto-learn, code review, checkpoint/resume
- Strict hexagonal architecture (pattern hive) -- each feature module is its own hexagon
- Zod-first type system: schemas are source of truth, inferred as TypeScript types
- Rich domain classes with business methods (Naboo pattern)
- Standalone `tff` CLI AND installable as PI extensions into vanilla `pi` CLI
- Compatible with PI's full extension ecosystem (plannotator, GitHub, etc.)

### Non-Goals

- Beads/Dolt integration (dropped -- SQLite + git orphan branches)
- Custom UI framework (uses PI's `pi-tui`)
- Multi-LLM provider support (Claude-only via PI SDK)
- GitHub Projects V2 / Issues sync

---

## 2. Architecture Overview

### Deployment Model

Hybrid (GSD-2 pattern):
- `npm install -g @the-forge-flow/cli` installs `tff` binary (PI coding agent + TFF extensions)
- TFF extensions also installable into vanilla `pi` CLI
- Compatible with any PI extension

### Package Structure [BUILT]

```
the-forge-flow-pi/
  src/
    kernel/                          # Shared DDD building blocks
    hexagons/                        # The pattern hive
      project/      [BUILT]
      milestone/    [BUILT]
      slice/        [BUILT]
      task/         [BUILT]
      execution/    [BUILT]
      workflow/     [BUILT]
      settings/     [BUILT]
      review/       [PLANNED - M05]
      intelligence/ [PLANNED - M06]
    infrastructure/                  # Cross-cutting adapters
      pi/           [BUILT]          # PI SDK extension wiring
    cli/            [PARTIAL]        # Entry point (awaiting PI SDK)
    resources/                       # Prompts/agents/skills (empty)
```

### Architectural Rules [BUILT -- enforced by Biome]

1. Hexagons import only from `kernel/` and own internals -- never cross-hexagon internals
2. Cross-hexagon queries via ports (dependency inversion) exported through barrels
3. Cross-hexagon notifications via domain events through `EventBusPort` (sequential, not concurrent)
4. Each hexagon exports public barrel (`index.ts`) -- ports, events, DTOs only
5. Infrastructure adapters implement ports defined in hexagons
6. Workflow hexagon orchestrates but does not own -- drives transitions via events and ports
7. Every hexagon works standalone outside workflow context

---

## 3. Kernel [BUILT]

### Base Classes
- `AggregateRoot<T>` -- event publishing via `pullEvents()`
- `Entity<T>` -- identity + serialization
- `ValueObject<T>` -- structural equality
- `DomainEvent` -- with correlationId/causationId

### Core Schemas
- `IdSchema` (UUID), `TimestampSchema` (ISO date)
- `ComplexityTierSchema`: `"S" | "F-lite" | "F-full"`
- `ModelProfileNameSchema`: `"quality" | "balanced" | "budget"`

### Result Type
`Result<T, E> = { ok: true; data: T } | { ok: false; error: E }` -- no exceptions in domain

### Ports
- `EventBusPort` -- publish/subscribe (sequential handlers)
- `DateProviderPort` -- time abstraction
- `GitPort` -- branches, commits, status, log, diff, worktrees
- `GitHubPort` -- PR creation/listing, comments
- `StateSyncPort` -- push/pull state to orphan branches
- `LoggerPort` -- logging abstraction

### Error Hierarchy
`BaseDomainError` -> `PersistenceError`, `GitError`, `GitHubError`, `SyncError`, `InvalidTransitionError`

### Event Names [BUILT]
`EVENT_NAMES` as `const` object for compile-time safety -- prevents typo-based subscription failures.

### Agent Subsystem [BUILT]
- 4 identity agents: `code-reviewer`, `spec-reviewer`, `security-auditor`, `subagent`
- Dynamic executors: fresh subagent per task (no fixed identity) -- key for fresh-reviewer enforcement
- `AgentCardSchema`, `AgentDispatchConfigSchema`, `AgentResultSchema`, `AgentCostSchema`
- Agent status protocol: `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`

---

## 4. Hexagons

### 4.1 Project Hexagon [BUILT]

**Aggregate:** `Project` (singleton per repo)

| Component | Status |
|---|---|
| ProjectPropsSchema | BUILT |
| Project aggregate (init, updateVision) | BUILT |
| ProjectInitializedEvent | BUILT |
| ProjectRepositoryPort | BUILT |
| ProjectFileSystemPort | BUILT |
| InitProjectUseCase | BUILT |
| SqliteProjectRepository | BUILT |
| InMemoryProjectRepository | BUILT |
| NodeProjectFileSystemAdapter | BUILT |
| PI extension (init-project command) | BUILT |
| Tests: 7 specs | BUILT |

### 4.2 Milestone Hexagon [BUILT]

**Aggregate:** `Milestone` -- status: `open -> in_progress -> closed`

| Component | Status |
|---|---|
| MilestonePropsSchema (label: `M\d{2,}`) | BUILT |
| Milestone aggregate (createNew, activate, close) | BUILT |
| MilestoneCreatedEvent, MilestoneClosedEvent | BUILT |
| MilestoneRepositoryPort | BUILT |
| SqliteMilestoneRepository | BUILT |
| InMemoryMilestoneRepository | BUILT |
| Tests: 2 specs | BUILT |

### 4.3 Slice Hexagon [BUILT]

**Aggregate:** `Slice` -- 8-state FSM

**State machine:**
```
discussing  -> researching, planning
researching -> planning
planning    -> executing, planning (replan loop)
executing   -> verifying
verifying   -> executing (fail), reviewing
reviewing   -> executing (fail), completing
completing  -> closed
```

| Component | Status |
|---|---|
| SlicePropsSchema, SliceStatusSchema (8 states) | BUILT |
| ComplexityTierSchema + classifyComplexity() | BUILT |
| SliceStatusVO (transition rules) | BUILT |
| Slice aggregate (transitionTo, classify) | BUILT |
| SliceCreatedEvent, SliceStatusChangedEvent | BUILT |
| SliceRepositoryPort | BUILT |
| WorkflowSliceTransitionAdapter | BUILT |
| SqliteSliceRepository | BUILT |
| InMemorySliceRepository | BUILT |
| Tests: 4 specs | BUILT |

### 4.4 Task Hexagon [BUILT]

**Aggregate:** `Task` -- status: `open -> in_progress/blocked -> closed`

| Component | Status |
|---|---|
| TaskPropsSchema, TaskStatusSchema, WaveSchema | BUILT |
| TaskStatusVO (transition rules) | BUILT |
| Task aggregate (complete, block, unblock, assignToWave) | BUILT |
| TaskCompletedEvent, TaskBlockedEvent, TaskCreatedEvent | BUILT |
| DetectWavesUseCase (Kahn's topological sort) | BUILT |
| CreateTasksUseCase | BUILT |
| TaskRepositoryPort, WaveDetectionPort, CreateTasksPort | BUILT |
| SqliteTaskRepository | BUILT |
| InMemoryTaskRepository | BUILT |
| Tests: 6 specs | BUILT |

### 4.5 Execution Hexagon [BUILT]

**Aggregate:** `Checkpoint` -- tracks wave progress, executor log, completed tasks

**Dispatch flow:**
1. Load slice + tasks -> detect waves (Kahn's sort)
2. Load or create checkpoint
3. Per wave (sequential): dispatch tasks in parallel via `AgentDispatchPort`
4. Checkpoint after each task completion
5. Emit `AllTasksCompletedEvent`

**Concurrency:** Orchestrator owns SQLite. Agents run in worktrees, communicate via `AgentDispatchPort`.

| Component | Status |
|---|---|
| CheckpointPropsSchema, ExecutorLogEntrySchema | BUILT |
| Checkpoint aggregate (recordTaskStart/Complete, advanceWave) | BUILT |
| AllTasksCompletedEvent, CheckpointSavedEvent, TaskExecutionCompletedEvent | BUILT |
| AgentDispatchPort | BUILT |
| CheckpointRepositoryPort | BUILT |
| JournalRepositoryPort + JournalEntrySchema (8 entry types) | BUILT |
| MetricsRepositoryPort + MetricsQueryPort | BUILT |
| WorktreePort | BUILT |
| OverseerPort (async watchdog) | BUILT |
| OutputGuardrailPort | BUILT |
| PhaseTransitionPort | BUILT |
| RetryPolicy (DefaultRetryPolicy) | BUILT |
| ExecuteSliceUseCase | BUILT |
| ReplayJournalUseCase | BUILT |
| RollbackSliceUseCase | BUILT |
| AggregateMetricsUseCase | BUILT |
| RecordTaskMetricsUseCase | BUILT |
| CleanupOrphanedWorktreesUseCase | BUILT |
| DomainRouter (file path -> skill mapping) | BUILT |
| PromptBuilder (task-specific prompts) | BUILT |
| JournalEventHandler | BUILT |
| TimeoutStrategy (complexity-aware) | BUILT |
| **Guardrail rules (composable, 5 rules):** | BUILT |
| -- DangerousCommandRule | BUILT |
| -- CredentialExposureRule | BUILT |
| -- DestructiveGitRule | BUILT |
| -- FileScopeRule | BUILT |
| -- SuspiciousContentRule | BUILT |
| ComposableGuardrailAdapter | BUILT |
| ComposableOverseerAdapter | BUILT |
| PiAgentDispatchAdapter | BUILT |
| GitWorktreeAdapter | BUILT |
| JsonlJournalRepository | BUILT |
| JsonlMetricsRepository | BUILT |
| InMemory adapters (7 total) | BUILT |
| Tests: 48 specs | BUILT |

**Planned additions (Design Improvements -- targeting M04):**

| Improvement | Description | Status |
|---|---|---|
| **A. Per-task reflection** | After task completes, same agent re-reads diff vs ACs. Blockers -> retry. Warnings recorded. `ReflectionResultSchema` extends `AgentResultSchema`. | PLANNED |
| **B. Model downshift fallback** | 3-step chain: retry same model (1x) -> downshift to cheaper (1x) -> escalate. `FallbackStrategySchema` in settings. Checkpoint saved before retry. | PLANNED |
| **G. Full pre/post-dispatch guardrails** | Pre-dispatch: scope containment, worktree state, budget check. Post-dispatch: file containment, lint, tests, secrets, file size. Auto-retry once with feedback. | PARTIAL (post-dispatch built, pre-dispatch planned) |
| **I. Compressor notation** | All generated artifacts use formal logic symbols (~50-60% token reduction). Schemas/code uncompressed. | PLANNED |

### 4.6 Settings Hexagon [BUILT]

**Value Object:** `ProjectSettings` -- immutable settings holder

**Settings cascade:**
```
Hardcoded defaults (Zod .default())
  <- tff-state/main settings.yaml (team-shared)
    <- .tff/settings.yaml (local overrides)
      <- environment variables (TFF_MODEL, TFF_AUTONOMY, etc.)
```

**Model routing:** role-based profiles with phase overrides and budget awareness.
- `quality` (opus) -- reviewers, security auditor
- `balanced` (sonnet) -- planning, research
- `budget` (haiku/sonnet) -- execution, fixers
- Complexity mapping: S -> budget, F-lite -> balanced, F-full -> quality
- Budget enforcement: ceiling with progressive downshift (50% -> balanced, 75% -> budget)

| Component | Status |
|---|---|
| SettingsSchema (model routing, autonomy, auto-learn, guardrails, overseer) | BUILT |
| ModelRoutingConfigSchema (profiles, complexity mapping, budget, fallback chains) | BUILT |
| AutonomyConfigSchema (guided / plan-to-pr) | BUILT |
| AutoLearnConfigSchema (weights, guardrails, clustering) | BUILT |
| GuardrailsConfigSchema (5 rule types, severity levels) | BUILT |
| OverseerConfigSchema (timeouts per tier, retry thresholds) | BUILT |
| ProjectSettings value object | BUILT |
| LoadSettingsUseCase (YAML + env vars, resilient parsing) | BUILT |
| MergeSettingsUseCase (cascade merge) | BUILT |
| ResolveModelUseCase (phase + complexity + budget -> model) | BUILT |
| SettingsFilePort, EnvVarPort, BudgetTrackingPort | BUILT |
| FsSettingsFileAdapter, ProcessEnvVarAdapter | BUILT |
| InMemory adapters | BUILT |
| Tests: 6 specs | BUILT |

### 4.7 Workflow Hexagon [BUILT]

**Aggregate:** `WorkflowSession` -- one per milestone, 11-phase FSM

**Phases:** `idle | discussing | researching | planning | executing | verifying | reviewing | shipping | completing-milestone | paused | blocked`

**Triggers:** `start | next | skip | back | fail | approve | reject | pause | resume | abort`

**Key transitions:**
```
idle        + start   -> discussing
discussing  + next    -> researching  (guard: notSTier)
discussing  + next    -> planning     (guard: isSTier -- skip research)
discussing  + skip    -> planning
researching + next    -> planning
planning    + approve -> executing    (human gate)
planning    + reject  -> planning     (replan, retryCount++)
executing   + next    -> verifying
verifying   + approve -> reviewing
verifying   + reject  -> executing    (retryCount++)
reviewing   + approve -> shipping     (human gate)
reviewing   + reject  -> executing    (retryCount++)
shipping    + next    -> idle         (slice -> closed)
idle        + next    -> completing-milestone  (guard: allSlicesClosed)
Any active  + fail    -> blocked      (guard: retriesExhausted)
Any active  + pause   -> paused       (saves previousPhase)
paused      + resume  -> previousPhase
```

**Autonomy modes:**
- `guided` -- pauses at every transition for human approval
- `plan-to-pr` -- auto-advances non-gate phases; human gates: plan approval, review approval, ship

**Skill injection per phase:**

| Phase/Role | Skills Injected (max 3, rigid first) |
|---|---|
| Discussing | brainstorming |
| Researching | (free-form exploration) |
| Planning | writing-plans, stress-testing-specs |
| Executing (dev) | test-driven-development, hexagonal-architecture, commit-conventions |
| Executing (debug) | systematic-debugging |
| Verifying | acceptance-criteria-validation, verification-before-completion |
| Reviewing (code) | code-review-protocol |
| Reviewing (security) | code-review-protocol (security focus) |
| Reviewing (spec) | architecture-review |
| Shipping | finishing-work, commit-conventions |

| Component | Status |
|---|---|
| WorkflowSessionPropsSchema (11 phases, 10 triggers) | BUILT |
| WorkflowSession aggregate (trigger, assignSlice, clearSlice) | BUILT |
| TRANSITION_TABLE (declarative, guard functions) | BUILT |
| Autonomy policy (auto-transition decision logic) | BUILT |
| Phase-status mapping (workflow phase -> slice status) | BUILT |
| PHASE_SKILL_MAP, SKILL_REGISTRY | BUILT |
| WorkflowPhaseChangedEvent, WorkflowEscalationRaisedEvent | BUILT |
| ContextPackage VO, Escalation VO, NextStepSuggestion VO | BUILT |
| OrchestratePhaseTransitionUseCase | BUILT |
| StartDiscussUseCase | BUILT |
| ClassifyComplexityUseCase | BUILT |
| WriteSpecUseCase, WritePlanUseCase, WriteResearchUseCase | BUILT |
| GetStatusUseCase, SuggestNextStepUseCase | BUILT |
| WorkflowSessionRepositoryPort | BUILT |
| SliceTransitionPort, ContextStagingPort | BUILT |
| ArtifactFilePort, AutonomyModeProvider, ModelProfileResolverPort | BUILT |
| NodeArtifactFileAdapter | BUILT |
| InMemory adapters (session repo, context staging, artifact file) | BUILT |
| PI tools (classify-complexity, workflow-transition, write-*) | BUILT |
| PI commands (/discuss, /plan, /research) | BUILT |
| Protocols (discuss, plan, research) | BUILT |
| Tests: 20+ specs | BUILT |

**Note:** ContextStagingPort is currently NoOp -- needs real implementation for skill injection.

### 4.8 Review Hexagon [PLANNED -- M05]

**Aggregate:** `Review` -- verdict: `approved | changes_requested | rejected`
**Roles:** `code-reviewer | spec-reviewer | security-auditor`

**3-stage review (parallel dispatch -- Improvement D):**
1. All 3 reviewers dispatch in parallel (Promise.all with per-agent timeout)
2. Findings merged, deduplicated by file+line, contradictions flagged for human
3. Any critical -> `changes_requested`; all approved -> `approved`
4. `CHANGES_REQUESTED` spawns fixer agent -> loop until approve (max 2 cycles)

**Fresh-reviewer enforcement:** reviewer agent != executor agent for that slice. `ExecutorQueryPort` cross-hexagon query.

**Critique-then-reflection:** two-pass pattern (exhaustive critique -> meta-analysis/prioritization).

**Fixer behavior (receiving code review):** per finding: UNDERSTAND -> VERIFY -> EVALUATE -> IMPLEMENT. Wrong finding -> push back with evidence.

| Component | Status |
|---|---|
| ReviewPropsSchema (with findings: severity, file, line range) | PLANNED |
| MergedReviewPropsSchema (source reviews, conflicts) | PLANNED |
| Review aggregate (record, enforceFreshReviewer) | PLANNED |
| ReviewRecordedEvent | PLANNED |
| FreshReviewerViolationError | PLANNED |
| ConductReviewUseCase (parallel 3-stage) | PLANNED |
| ExecutorQueryPort (cross-hexagon) | PLANNED |
| ReviewUIPort (terminal default, plannotator auto-detect) | PLANNED |
| `/tff:verify` -- binary AC validation (READ -> RUN -> EVIDENCE -> VERDICT) | PLANNED |
| `/tff:ship` -- PR creation, merge gate, worktree cleanup | PLANNED |
| `/tff:complete-milestone` -- audit + PR to main | PLANNED |

### 4.9 Intelligence Hexagon [PLANNED -- M06]

**Aggregates:** `Skill`, `Observation`, `Pattern`, `Candidate`

**Skill system:**
- Types: `rigid` (follow exactly) | `flexible` (adapt to context)
- 18 methodology skills ported from TFF-CC
- Layered: markdown for LLM guidance + `SkillEnforcer` for programmatic hard gates
- Name validation: `[a-z][a-z0-9-]*`, 1-64 chars

**Auto-learn pipeline:**
1. `ExtractNgramsUseCase` -- sliding window over observation sequences
2. `AggregateUseCase` -- filter by minCount (3), remove framework noise (>80% freq)
3. `RankCandidatesUseCase` -- weighted scoring: frequency 0.25, breadth 0.30, recency 0.25, consistency 0.20
4. `CreateSkillUseCase` -- draft from candidate (>= 3 session evidence, no speculation)
5. `RefineSkillUseCase` -- bounded: max 20% drift/refinement, 60% cumulative, 7-day cooldown, min 3 corrections
6. `DetectClustersUseCase` -- Jaccard distance, >= 70% co-activation -> propose bundle

**5-level tiered memory (Improvement E):**

| Level | Name | Scope | Storage | Retention |
|---|---|---|---|---|
| L0 | Working | Single agent turn | Context window | Ephemeral |
| L1 | Session | Single task/dispatch | Checkpoint | Until slice closes |
| L2 | Episodic | Cross-task observations | journal.jsonl + SQLite | Until milestone closes |
| L3 | Semantic | Extracted patterns | SQLite (patterns table) | Permanent (with decay) |
| L4 | Procedural | Refined skills | Skill files + SQLite | Permanent |

**Promotion flow:** L0 (agent works) -> L1 (task completes, checkpoint) -> L2 (pattern across tasks) -> L3 (n-gram extraction) -> L4 (skill creation threshold met)

**Context injection:** L4 in system prompt, L3 as "hints" in task prompt (top 3), L2 via `memory-recall` tool, L1 from checkpoint on resume.

**Architecture drift detection (Improvement H):**
- Triggers: slice transition, milestone close
- Checks: file size (>400 warn, >500 critical), boundary violations, test coverage delta, circular deps, domain leaks
- Advisory only -- no blocking. Surfaced in `/tff:status`.

**Metrics-informed suggestions (Improvement C):**
- `TaskMetricsSchema` replaces `CostEntrySchema` -- tracks tokens, cost, duration, success, retries, downshift, reflection
- `/tff:settings` displays aggregated metrics + advisory suggestions
- No auto-adjustment

| Component | Status |
|---|---|
| SkillPropsSchema (name, type, markdown, enforcer rules, drift) | PLANNED |
| Skill aggregate (refine, checkDrift) | PLANNED |
| Observation entity + JSONL storage + dead-letter queue | PLANNED |
| Pattern detection pipeline (extract, aggregate, rank) | PLANNED |
| Skill creation + refinement (bounded guardrails) | PLANNED |
| SkillEnforcer system | PLANNED |
| Knowledge base learning (problem-solution pairs) | PLANNED |
| Cluster detection (Jaccard) | PLANNED |
| MemoryEntrySchema (5 levels) | PLANNED |
| DriftReportSchema, DriftCheckSchema | PLANNED |
| TaskMetricsSchema (richer than CostEntry) | PLANNED |
| AggregateMetricsUseCase (suggestions) | PLANNED |
| ScanArchitectureDriftUseCase | PLANNED |
| Commands: `/tff:suggest`, `/tff:skill:new`, `/tff:learn`, `/tff:patterns`, `/tff:compose` | PLANNED |

---

## 5. PI SDK Integration [PARTIAL]

### Extension Architecture [BUILT]
Each hexagon contributes a PI extension registering tools, commands, and event handlers via `ExtensionAPI`.

### Zod-to-JSON-Schema Adapter [BUILT]
`createZodTool()` bridges Zod schemas to PI SDK's TypeBox-based tools. Constraint: tool schemas use only JSON-Schema-compatible Zod features (no `.transform()`, `.pipe()`, `.refine()` in tool schemas).

### Agent Dispatch [BUILT]
`PiAgentDispatchAdapter` creates fresh PI session per task via `createAgentSession()`. Skills injected in system prompt.

### Registered Commands [PARTIAL]

| Command | Phase | Status |
|---|---|---|
| `/tff:new` | Init | BUILT (M02) |
| `/tff:status` | Status | BUILT (M02) |
| `/discuss` | Discussing | BUILT (M03) |
| `/research` | Researching | BUILT (M03) |
| `/plan` | Planning | BUILT (M03) |
| `/tff:execute` | Executing | PLANNED (M04) |
| `/tff:pause` | Executing | PLANNED (M04) |
| `/tff:resume` | Executing | PLANNED (M04) |
| `/tff:verify` | Verifying | PLANNED (M05) |
| `/tff:ship` | Shipping | PLANNED (M05) |
| `/tff:complete-milestone` | Completing | PLANNED (M05) |
| `/tff:quick` | S-tier shortcut | PLANNED (M07) |
| `/tff:debug` | Debugging | PLANNED (M07) |
| `/tff:health` | Diagnostics | PLANNED (M07) |
| `/tff:progress` | Dashboard | PLANNED (M07) |
| `/tff:add-slice`, `/tff:remove-slice`, `/tff:insert-slice` | Management | PLANNED (M07) |
| `/tff:rollback` | Recovery | PLANNED (M07) |
| `/tff:audit-milestone` | Audit | PLANNED (M07) |
| `/tff:map-codebase` | Analysis | PLANNED (M07) |
| `/tff:sync` | Sync | PLANNED (M07) |
| `/tff:suggest`, `/tff:skill:new`, `/tff:learn`, `/tff:patterns`, `/tff:compose` | Intelligence | PLANNED (M06) |
| `/tff:settings` | Configuration | PLANNED (M07) |
| `/tff:help` | Help | PLANNED (M07) |

---

## 6. Persistence & State Management

> Per-branch orphan state model (supersedes original single-orphan design)

### 6.1 Local State (`.tff/`) [BUILT -- structure exists]

```
.tff/
  state.db                     # SQLite
  settings.yaml
  journal.jsonl                # Append-only mutation journal
  PROJECT.md
  branch-meta.json             # [PLANNED] Branch mapping (stateId, codeBranch, stateBranch)
  milestones/
    M04/
      REQUIREMENTS.md
      slices/
        M04-S01/
          SPEC.md, PLAN.md, RESEARCH.md, CHECKPOINT.md
  skills/                      # Custom project skills
  observations/                # JSONL observation logs
  metrics.json                 # Cost tracking
  worktrees/                   # Git worktrees (ephemeral)
```

### 6.2 Per-Branch State Branches [PLANNED -- M07]

Every code branch gets a mirrored orphan state branch:

```
Code branches:              State branches:
  main                        tff-state/main              (orphan root)
  milestone/M04               tff-state/milestone/M04     (forked from tff-state/main)
    slice/M04-S01               tff-state/slice/M04-S01   (forked from tff-state/milestone/M04)
```

Root state branch (`tff-state/main`) is a true git orphan. Child branches forked via `git branch` -- shared history within state family enables `git merge` on ship.

### 6.3 SQLite Persistence: JSON Export [PLANNED]

`.db` files never committed. State exported to `state-snapshot.json` (diffable, mergeable):

```typescript
StateSnapshotSchema = z.object({
  version: z.number().int(),
  exportedAt: TimestampSchema,
  project: ProjectPropsSchema.optional(),
  milestones: z.array(MilestonePropsSchema),
  slices: z.array(SlicePropsSchema),
  tasks: z.array(TaskPropsSchema),
  workflowSession: WorkflowSessionPropsSchema.optional(),
});
```

Schema evolution: Zod `.default()` for additive fields. Migration functions per version bump for breaking changes.

### 6.4 State Branch Lifecycle [PLANNED]

**Create:** Fork from parent state branch on code branch creation.

**Sync:** At lifecycle events only (no debounced timer):

| Event | Journal | State Branch |
|---|---|---|
| Task started/completed/written | Append | -- |
| Slice phase transition | Append | Auto-sync |
| Milestone open/close | Append | Auto-sync |
| `/tff:ship` | Append | Auto-sync |
| `/tff:sync` | Append | Auto-sync |
| Graceful shutdown / SIGTERM | Flush | Best-effort |

Sync uses git plumbing (no temp worktrees): `git hash-object -w` + `git mktree` + `git commit-tree` + `git update-ref`.

**Restore:** Post-checkout hook triggers `tff sync --restore`. Fallback: every TFF command checks `branch-meta.json` vs actual branch, triggers restore on mismatch.

**Merge back (on ship):** Programmatic merge by entity ID -- child's owned entities win, parent's others win. Artifacts have no overlap by construction.

**Rename handling:** Stable `stateId` survives renames. Lazy detection disambiguates: missed checkout vs rename vs fresh.

### 6.5 Worktree Isolation [PARTIAL -- GitWorktreeAdapter built]

Each worktree has own `.tff/` tied to own state branch. Zero conflicts.

### 6.6 Crash Recovery [PARTIAL -- journal + replay built, state branch recovery planned]

| Scenario | Recovery | Loss |
|---|---|---|
| Agent crash, `.tff/` intact | Replay journal.jsonl | None |
| Agent crash, `.tff/` gone | Pull from tff-state/\<branch\> | Since last lifecycle sync |
| No state branch | Check parent, fork | Slice state since last merge |
| Crash during restore | Restore from `.tff.backup.*` | None |

### 6.7 Journal as Unified Transaction Log (Improvement F) [PARTIAL -- base journal built, consumers planned]

Elevated from crash-recovery to first-class event backbone. Entry types:

**Built:** task-started, task-completed, task-failed, file-written, checkpoint-saved, phase-changed, artifact-written

**Planned (Improvement F):** observation-recorded, pattern-detected, skill-refined, task-retried, model-downshifted, guardrail-violation, drift-scan-completed, metrics-snapshot

**Consumers (planned):**
- Recovery consumer (replays entries to reconstruct state) -- BUILT
- Memory consumer (promotes observations L0->L4) -- PLANNED
- Metrics consumer (aggregates for suggestions) -- PLANNED
- Drift consumer (feeds DriftReport at milestone boundaries) -- PLANNED

---

## 7. Testing Strategy [BUILT]

- **Framework:** Vitest
- **Colocation:** `*.spec.ts` next to source files
- **Builders:** Faker-based, next to entities
- **In-Memory Adapters:** Next to SQLite counterparts
- **Contract Tests:** Abstract tests for repository/port interfaces
- **Current coverage:** 131 spec files across all built hexagons
- **Lint:** Biome enforcing hexagon import boundaries

---

## 8. Milestones

### Milestone Numbering

The design spec used M01a/M01b/M02-M06. Actual milestones are M01-M08:

| Spec Name | Actual | Goal | Status |
|---|---|---|---|
| M01a: Kernel + Entity | **M01** | DDD foundations + first 3 hexagons | CLOSED |
| M01b: Task + Settings + CLI | **M02** | Complete entity stack, wire CLI | CLOSED |
| M02: Workflow Engine | **M03** | Orchestrator, phase commands, artifacts | CLOSED |
| M03: Execution & Recovery | **M04** | Wave dispatch, checkpoints, guardrails | IN PROGRESS (8/10 slices) |
| M04: Review & Ship | **M05** | Fresh-reviewer, 3-stage review, PR creation | PLANNED |
| M05: Intelligence & Auto-Learn | **M06** | Observations, patterns, skills, auto-learn | PLANNED |
| M06: Team & Polish | **M07** | Per-branch sync, state reconstruction, remaining commands | PLANNED |
| (new) Expansion | **M08** | Empty stub | PLANNED |

### M04: Execution & Recovery [IN PROGRESS -- 8/10 slices closed]

| Slice | Content | Status |
|---|---|---|
| S01 | Checkpoint entity + repository | CLOSED |
| S02 | Wave-based parallel dispatch (ExecuteSliceUseCase) | CLOSED |
| S03 | Agent dispatch port + PI adapter | CLOSED |
| S04 | Worktree management | CLOSED |
| S05 | Journal + crash recovery (ReplayJournal, RollbackSlice) | CLOSED |
| S06 | Cost tracking (metrics schemas, repositories, aggregation) | CLOSED |
| S07 | Async watchdog/overseer | CLOSED |
| S08 | Output safety guardrails (5 composable rules) | CLOSED |
| S09 | Async overseer/watchdog (extended) | OPEN |
| S10 | Commands (/tff:execute, /tff:pause, /tff:resume) | OPEN |

**Design improvements targeting M04:** A (reflection), B (fallback chain), G (full guardrails -- pre-dispatch), I (compressor notation)

### M05: Review & Ship [PLANNED]

**Requirements (10):**
- R01: Review hexagon (aggregate, schemas, findings)
- R02: Fresh-reviewer enforcement (ExecutorQueryPort cross-hexagon query)
- R03: Multi-stage review pipeline (3-stage parallel -- Improvement D)
- R04: Critique-then-reflection review (two-pass pattern)
- R05: Review UI port (terminal + plannotator auto-detect)
- R06: Agent authoring protocol (identity-only, <=30 lines, skills loaded)
- R07: Receiving code review (fixer behavior -- UNDERSTAND/VERIFY/EVALUATE/IMPLEMENT)
- R08: Verify command (`/tff:verify`)
- R09: Ship command (`/tff:ship`) -- PR creation, merge gate, worktree cleanup
- R10: Complete milestone (`/tff:complete-milestone`) -- audit + PR to main

### M06: Intelligence & Auto-Learn [PLANNED]

**Requirements (8):**
- R01: Skill entity (aggregate, enforcer rules, drift tracking)
- R02: Observation system (JSONL, dead-letter queue, resilient)
- R03: Pattern detection pipeline (extract n-grams, aggregate, rank)
- R04: Skill creation + refinement (bounded guardrails)
- R05: Skill enforcer system (programmatic validation)
- R06: Knowledge base learning (problem-solution pairs)
- R07: Cluster detection (Jaccard, co-activation bundles)
- R08: Commands (/tff:suggest, /tff:skill:new, /tff:learn, /tff:patterns, /tff:compose)

**Design improvements targeting M06:** C (metrics suggestions), E (tiered memory), F (journal consumers), H (drift detection)

### M07: Team Collaboration & Polish [PLANNED -- expanded with gap analysis]

**Original scope:** Per-branch sync, state reconstruction, remaining commands, polish.

**Per-branch state persistence (6 slices):**
- State branch CRUD (create/fork, sync, restore, delete)
- JSON export/import (SQLite <-> state-snapshot.json)
- Post-checkout hook + fallback detection
- Worktree isolation integration
- Rename detection + state branch migration
- Merge-back on ship/complete-milestone

**Remaining commands:** /tff:quick, /tff:debug, /tff:health, /tff:progress, /tff:add-slice, /tff:remove-slice, /tff:insert-slice, /tff:rollback, /tff:audit-milestone, /tff:map-codebase, /tff:sync, /tff:settings, /tff:help

**Gap analysis additions [NEW]:**

| ID | Feature | Priority |
|---|---|---|
| G04 | **Stack auto-discovery** -- runtime detection of project tech stack (languages, frameworks, linters, test runners) to auto-populate `settings.yaml`. `DiscoverStackUseCase`. | P1 |
| G02 | **Failure policy model** -- per-stage `strict/tolerant/lenient` configurable in settings. Research tolerates partials, execution is strict, suggestions are lenient. | P2 |
| G07 | **Shared memory per project** -- persistent project-scoped knowledge store across ALL sessions/agents. `ProjectMemoryPort`, categories (architecture-decisions, gotchas, conventions), auto-populated from completions, relevance-based injection. Distinct from L0-L4 tiered memory. | P1 |
| G03 | **Per-stage quality metrics** -- `QualitySnapshot` per stage: lint errors, test counts, tool failures, review scores, lines changed. Feeds into metrics-informed suggestions. | P2 |
| G09 | **Tool/command rules per agent** -- declarative `ToolPolicySchema` in settings: allowed/blocked tools by tier and by role. Security auditor = read-only. S-tier = no sub-agents. Enforced at dispatch time. | P1 |
| G10 | **Code intelligence (AST/LSP)** -- optional `CodeIntelligencePort` with Tree-sitter parsing for semantic code understanding: imports, exports, dependency graph, impact analysis. | P3 |

### M08: Expansion [PLANNED -- filled from gap analysis]

| ID | Feature | Priority |
|---|---|---|
| G08 | **CQ integration** -- `CqKnowledgeAdapter` implementing `SharedKnowledgePort`. Query before unfamiliar work, propose learnings, confirm/flag guidance. Leverages existing MCP server. | P2 |
| G01 | **Stage output caching with TTL** -- cache-key per phase (hash of inputs), skip unchanged stages on re-execute. TTL configurable per stage. | P3 |
| G05 | **Hook-based early guardrails** -- `preToolUse`/`postToolUse` hooks at tool invocation granularity (vs. dispatch level). Block secrets in writes, auto-format, log for observations. | P2 |
| G06 | **Richer init/setup chain** -- `/tff:env-check` (validate tools), `/tff:ci-setup` (scaffold GitHub Actions). | P3 |
| G11 | **CI/CD integration** -- GitHub Actions templates for TFF verify/review on PR, pre-commit hooks, status checks. | P3 |

---

## 9. Forgotten / Misaligned Items

Cross-referencing spec vs. built codebase revealed these discrepancies:

### In Spec, Not Yet In Code (Expected -- Future Milestones)

| Item | Expected In |
|---|---|
| Review hexagon (entire) | M05 |
| Intelligence hexagon (entire) | M06 |
| Per-branch state persistence | M07 |
| StateSyncPort implementations | M07 |
| SyncScheduler | M07 |
| GitHub port adapter (gh CLI) | M05 (ship) or M07 |
| ReconstructStateUseCase | M07 |
| MarkdownCheckpointRepository | M04 (S10) |

### In Code, Not Explicitly In Spec (Organic Growth -- OK)

These emerged during implementation and are architecturally sound:

| Item | Location | Note |
|---|---|---|
| TaskCreatedEvent | Task hexagon | Natural addition |
| CheckpointSavedEvent | Execution hexagon | Needed for journal integration |
| WorkflowEscalationRaisedEvent | Workflow hexagon | Needed for escalation flow |
| Escalation VO | Workflow hexagon | Human intervention marker |
| NextStepSuggestion VO | Workflow hexagon | SuggestNextStepUseCase output |
| ContextPackage VO | Workflow hexagon | Agent context packaging |
| DomainRouter | Execution hexagon | File path -> skill mapping |
| PromptBuilder | Execution hexagon | Task-specific prompt generation |
| JournalEventHandler | Execution hexagon | Checkpoint event recording |
| DefaultRetryPolicy | Execution hexagon | Retry strategy implementation |
| TimeoutStrategy | Execution hexagon | Complexity-aware timeouts |
| Protocol files (discuss, plan, research) | Workflow/PI | Structured messaging |
| BudgetTrackingPort | Settings hexagon | Token/cost budget tracking |
| AlwaysUnderBudgetAdapter | Settings hexagon | Testing mock |
| `src/resources/` directory | Root | Empty, reserved for prompts/agents/skills |

### Potential Gaps To Investigate

| Item | Concern |
|---|---|
| ContextStagingPort is NoOp | Real skill injection not wired -- needs implementation before M04 S10 |
| CLI main.ts is skeleton | Awaiting PI SDK deployment -- not blocking but needed for standalone `tff` binary |
| SQLite repos: only 4 hexagons | Milestone, Project, Slice, Task have SQLite. Execution/Workflow/Settings use in-memory or file-based. May need SQLite for WorkflowSession persistence. |
| No integration test for full dispatch loop | PiAgentDispatchAdapter exists but no end-to-end test with real PI session |

---

## 10. Dependencies

### Runtime
- `zod` -- schema validation
- `zod-to-json-schema` -- Zod -> JSON Schema bridge for PI SDK
- `@mariozechner/pi-ai` -- LLM abstraction
- `@mariozechner/pi-agent-core` -- Agent runtime
- `@mariozechner/pi-coding-agent` -- CLI coding agent + extension system
- `better-sqlite3` -- local state (sync SQLite)
- `yaml` -- settings parsing

### Dev
- `typescript` (ES2022, ESNext modules, strict)
- `vitest` -- test framework
- `@faker-js/faker` -- test builders
- `@biomejs/biome` -- linting + formatting (line width 100, 2-space indent)
- `tsup` -- bundling

### Path Aliases
- `@kernel` -> `src/kernel`
- `@hexagons/*` -> `src/hexagons/*`
- `@infrastructure/*` -> `src/infrastructure/*`
- `@resources/*` -> `src/resources/*`

---

## 11. Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Type system | Zod schemas | Single source of truth, runtime validation, JSON Schema bridge |
| Import boundaries | Biome lint rules | Catch violations at check time |
| Persistence | SQLite + git orphan branches | Local recovery + team sync without external service |
| Domain errors | Result types | Pure functions, errors as data |
| Event model | Sequential EventBus | No race conditions, clear causality |
| Cross-hexagon queries | Ports (DI) | Decouples hexagons, testable |
| Agent execution | Fresh subagent per task | Clean context, isolation, deterministic |
| Wave execution | Parallel per-wave, sequential between waves | Respects dependency graph |
| Review | 3-stage parallel with fresh reviewers | Speed + independence |
| Skills | Rigid + flexible | Different enforcement strength |
| Memory | 5 levels (L0-L4) | Systematic promotion |
| Compression | Logic notation in artifacts | ~50-60% token reduction |
| State sync | Per-branch orphan states | Concurrent worktrees, rename safety |
| Agent types | 4 identity + dynamic executors | Fresh-reviewer guarantee |

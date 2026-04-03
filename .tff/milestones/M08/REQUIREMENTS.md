# M08: Intelligence and Auto-Learn

## Goal

Build the intelligence hexagon with the full auto-learn pipeline: observation capture, pattern detection, skill creation/refinement, cluster detection, tiered memory, and shared project memory.

## Requirements

### R01: Skill Entity

- `Skill` aggregate with `SkillPropsSchema` (id, name, description, type, markdown, enforcerRules, version, driftPct, lastRefinedAt, timestamps)
- Skill types: rigid (follow exactly) | flexible (adapt to context)
- Name validation: `[a-z][a-z0-9-]*`, 1-64 chars, no consecutive hyphens
- `refine()`, `checkDrift()` business methods
- `SkillRepositoryPort`, SQLite + in-memory adapters
- `SkillBuilder`

**AC:**
- Name regex enforced at creation
- Drift percentage tracked and queryable

### R02: Observation System

- `Observation` entity for capturing tool invocations
- Storage: `.tff/observations/` as JSONL files (one per session)
- Dead-letter queue: failed appends go to `dead-letter.jsonl`, replayed on next success
- Always resilient: observation failures never crash the main process (exit 0 equivalent)

**AC:**
- Zero data loss from observation capture
- Dead-letter replay tested
- Main process unaffected by observation failures

### R03: Pattern Detection Pipeline

Three-stage pipeline:
1. **Extract** (`ExtractNgramsUseCase`): group observations by session, extract n-grams, track count/sessions/projects/lastSeen
2. **Aggregate** (`AggregateUseCase`): filter by minCount (default 3), remove framework noise (>80% session frequency)
3. **Rank** (`RankCandidatesUseCase`): weighted scoring:
   - Frequency: 0.25 (how often the pattern appears)
   - Breadth: 0.30 (how many projects contain it)
   - Recency: 0.25 (14-day half-life)
   - Consistency: 0.20 (fraction of sessions containing it)

**AC:**
- Weights configurable via settings
- Framework noise filtered (common tool sequences excluded)
- Property-based tests for scoring weight stability (fast-check)

### R04: Skill Creation and Refinement

- `CreateSkillUseCase`: draft skill from candidate (requires >= 3 session evidence)
- Evidence table required (no speculation)
- `RefineSkillUseCase`: bounded refinement with guardrails:
  - Max 20% drift per refinement (character-level diff ratio)
  - Max 60% cumulative drift
  - 7-day cooldown between refinements
  - Min 3 corrections before proposing refinement
- Drafts saved to drafts dir -- user reviews before promotion
- Skill validation: name regex, description format, size limits, shell injection detection (allowlist + dangerous pattern blocklist)

**AC:**
- Cannot create skill with < 3 evidence sessions
- Drift limits enforced (20% per, 60% cumulative)
- Cooldown enforced (7-day minimum)
- Shell injection in skill content detected and blocked

### R05: Skill Enforcer System

- `SkillEnforcer` classes for programmatic validation alongside markdown guidance
- Layered approach: markdown for LLM guidance + enforcer for hard gates
- Enforcer rules defined per skill (name + check function)

**AC:**
- Enforcer runs independently of LLM (programmatic check)
- Failed enforcement blocks the operation (hard gate)

### R06: Knowledge Base Learning

- Store problem-solution pairs from successful task completions
- Queryable by semantic similarity for future tasks
- Indexed by: hexagon, error type, file patterns, skill used

**AC:**
- Successful completions automatically recorded
- Query returns ranked matches by relevance

### R07: Cluster Detection

- `DetectClustersUseCase`: find co-activated skill bundles
- Jaccard distance-based clustering
- Thresholds: min-sessions 3, min-patterns 2, jaccard-threshold 0.3
- >= 70% co-activation -> propose bundle (meta-skill with skill references)

**AC:**
- Clusters detected from real activation data
- Bundle proposals include co-activation percentage

### R08: Commands

- `/tff:suggest` -- show detected pattern candidates with summaries
- `/tff:skill:new` -- draft a new skill from a detected pattern or description
- `/tff:learn` -- detect corrections to existing skills and propose refinements
- `/tff:patterns` -- extract, aggregate, and rank patterns from observations
- `/tff:compose` -- detect skill co-activation clusters and propose bundles

**AC:**
- All commands produce human-readable output with actionable next steps
- Skill drafts require user approval before promotion

### R09: Metrics-Informed Suggestions (Design Improvement C)

- `TaskMetricsSchema` replaces `CostEntrySchema` -- tracks: taskId, sliceId, milestoneId, model (provider, modelId, profile), tokens (input, output), costUsd, durationMs, success, retries, downshifted, reflectionPassed, timestamp
- `AggregateMetricsUseCase`: reads from journal, computes on-demand recommendations
- Recommendations surfaced in `/tff:settings` as advisory text (e.g., "budget tasks have 92% success rate -- consider downshifting F-lite")
- No automatic model routing changes -- human stays in control

**AC:**
- TaskMetrics captured from every dispatch
- Suggestions computed on-demand (not stored)
- No auto-adjustment of model routing

### R10: 5-Level Tiered Memory (Design Improvement E)

- `MemoryEntrySchema`: id, level (working/session/episodic/semantic/procedural), kind, content, source (task/slice/milestone), relevanceScore, accessedAt, accessCount
- Five levels: L0 (context window, ephemeral) -> L1 (checkpoint, until slice closes) -> L2 (journal + SQLite, until milestone closes) -> L3 (SQLite patterns, permanent with decay) -> L4 (skill files, permanent)
- Promotion flow: L0 (agent works) -> L1 (task completes) -> L2 (pattern across tasks) -> L3 (n-gram extraction) -> L4 (skill creation threshold)
- Context injection: L4 in system prompt, L3 as "hints" (top 3 by relevance), L2 via `memory-recall` tool, L1 from checkpoint
- Integrates with existing auto-learn pipeline (R03-R04 operate on L2->L3->L4 transitions)

**AC:**
- Memory entries tracked with level and kind
- Promotion between levels is automatic (threshold-based)
- L3/L4 injected into agent prompts
- L2 available on-demand via tool

### R11: Journal Consumers (Design Improvement F)

- Elevate journal.jsonl from crash-recovery to unified event backbone
- New journal entry types: observation-recorded, pattern-detected, skill-refined, task-retried, model-downshifted, guardrail-violation, drift-scan-completed, metrics-snapshot
- Consumer architecture: `JournalConsumerPort` implementations registered in Intelligence hexagon
  - Recovery consumer (existing): replays entries to reconstruct state
  - Memory consumer: promotes observations through L0->L4 tiers
  - Metrics consumer: aggregates TaskMetrics for suggestions
  - Drift consumer: feeds DriftReport at milestone boundaries
- Each consumer tracks own read offset (stored in SQLite)
- Consumers invoked on-demand (not real-time streaming)

**AC:**
- Journal serves multiple consumers (not just recovery)
- Consumer offsets tracked (no re-processing)
- Journal format unchanged (JSONL, append-only, idempotent)

### R12: Architecture Drift Detection (Design Improvement H)

- `ScanArchitectureDriftUseCase`: milestone-boundary scan
- Triggers: slice transition, milestone close
- `DriftReportSchema`: id, milestoneId, sliceId, checks array, overallHealth (healthy/warning/critical)
- Checks:
  - File size: >400 lines warning, >500 critical
  - Boundary violations: any import crossing hexagon walls
  - Test coverage delta: >5% drop warning, >15% critical
  - Dependency complexity: circular deps, depth >3
  - Domain leaks: infrastructure types in domain layer
- DriftReport persisted in SQLite, summary in journal (`drift-scan-completed`)
- Warnings surfaced in `/tff:status` output
- Advisory only -- no blocking

**AC:**
- Drift scanned automatically at milestone boundaries
- All 5 checks produce structured results
- No deployments blocked (advisory only)
- Results visible in status output

### R13: Shared Memory Per Project (Gap G07)

- `ProjectMemoryPort` with key-value store scoped to project
- Storage: `.tff/memory/` directory or SQLite table
- Categories: architecture-decisions, domain-conventions, gotchas, resolved-bugs
- Read/write from any agent session
- Auto-populated from successful task completions (links to R06 knowledge base)
- Injected into agent context based on relevance (file paths, hexagon, phase)
- Synced via state branches (M07 state persistence)
- Eviction: LRU with configurable max entries, staleness detection
- Integrates with L0-L4 tiered memory (R10) -- this is the persistent cross-session layer that complements the per-agent promotion flow

**AC:**
- Memory persists across sessions and agents
- Relevant memories injected into agent context
- Stale entries evicted automatically

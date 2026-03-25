# M06: Intelligence and Auto-Learn

## Goal

Build the intelligence hexagon with the full auto-learn pipeline: observation capture, pattern detection, skill creation/refinement, and cluster detection.

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

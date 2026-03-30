# TFF-PI Design Improvements Specification

**Date:** 2026-03-27
**Status:** Draft
**Scope:** 9 improvements to the TFF-PI design spec, derived from cross-referencing Roxabi Talks, 21 Agentic Patterns, and Hive Architecture against the current design.

## Overview

These improvements enhance the existing TFF-PI design specification without changing its hexagonal architecture or core contracts. Six improve existing sections; three add new capabilities.

| # | Improvement | Category | Affects |
|---|---|---|---|
| A | Per-task reflection | Existing: Execution | Execution hexagon, AgentResult schema |
| B | Model downshift fallback | Existing: Execution | Execution hexagon, Settings |
| C | Metrics-informed suggestions | Existing: Settings | Settings hexagon, Intelligence hexagon |
| D | Parallel review dispatch | Existing: Review | Review hexagon, ConductReviewUseCase |
| E | 5-Level tiered memory | Existing: Intelligence | Intelligence hexagon, new Memory aggregate |
| F | Journal as unified transaction log | Existing: Persistence | Journal schema, Intelligence consumers |
| G | Full guardrails | New: Execution | Execution hexagon, new GuardrailPort |
| H | Architecture drift detection | New: Intelligence | Intelligence hexagon, new DriftReport VO |
| I | Compressor notation for artifacts | New: Cross-cutting | All generated artifacts (skills, agents, plans, specs, research, task prompts) |

---

## A. Per-Task Reflection

**Source:** Agentic Patterns #4 (Reflection Pattern)
**Affects:** Execution hexagon

### Problem

The current design dispatches tasks and records pass/fail. If an agent produces subtly wrong output (passes tests but violates acceptance criteria or introduces style drift), this isn't caught until the review phase -- after potentially many more tasks have built on the flawed output.

### Design

After each task completes successfully, the **same agent** re-reads its own diff and checks the output against acceptance criteria before the result is finalized.

**Schema addition to AgentResult:**

```typescript
export const ReflectionResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.object({
    criterion: z.string(),        // which acceptance criterion
    concern: z.string(),          // what the agent flagged
    severity: z.enum(['blocker', 'warning']),
  })),
  reflectedAt: TimestampSchema,
});

// Extend AgentResultSchema
export const AgentResultSchema = z.object({
  // ... existing fields ...
  reflection: ReflectionResultSchema.optional(),
});
```

**Flow change in ExecuteSliceUseCase:**

```
1. Agent completes task
2. Agent re-reads diff + acceptance criteria (self-reflection prompt)
3. If reflection.passed → record success
4. If reflection has blockers → record failure, agent retries (counts toward maxRetries)
5. If reflection has warnings only → record success with warnings attached
```

**Constraints:**
- Reflection uses the same agent session (no extra dispatch cost beyond the reflection prompt)
- Reflection prompt is injected as a second turn in the same session, not a new session
- Max 1 reflection per task (no reflection loops)

### Non-Goals

- Cross-task reflection (comparing output of task N against task N-1)
- External reflection (dispatching a different agent to review)

---

## B. Model Downshift Fallback Chain

**Source:** Agentic Patterns #11 (Exception Handling)
**Affects:** Execution hexagon, Settings hexagon

### Problem

Current design has `fallbackChains` in settings but no structured retry/downshift strategy when a model fails or produces poor results.

### Design

Three-step recovery chain with checkpoint preservation:

```
Step 1: Retry same model (1x) — transient failures
Step 2: Downshift to next cheaper model (1x) — model-specific issues
Step 3: Escalate to human — persistent failures
```

**Schema addition to Settings:**

```typescript
export const FallbackStrategySchema = z.object({
  retryCount: z.number().int().min(0).max(3).default(1),
  downshiftChain: z.array(ModelProfileNameSchema).default(['quality', 'balanced', 'budget']),
  checkpointBeforeRetry: z.boolean().default(true),
});

// Add to SettingsSchema.autonomy
autonomy: z.object({
  mode: z.enum(['guided', 'plan-to-pr']),
  maxRetries: z.number().int().min(0).default(2),
  fallbackStrategy: FallbackStrategySchema.default({}),
}),
```

**Flow in ExecuteSliceUseCase:**

```
1. Dispatch task with resolved model
2. On failure:
   a. Save checkpoint (if checkpointBeforeRetry)
   b. Retry same model (up to retryCount times)
3. If still failing:
   a. Downshift: pick next model in downshiftChain
   b. Dispatch with downshifted model (1 attempt)
4. If still failing:
   a. Transition to blocked, escalate to human
```

**Journal entries for observability:** `task-retried` and `model-downshifted` entry types (canonical definitions in Improvement F).

### Constraints

- `fallbackStrategy.retryCount` governs same-model retries within a single task attempt. `autonomy.maxRetries` remains the workflow-level cap on full re-execution cycles (verify-fail-reexecute). These are independent counters.
- Reflection-blocker failures (Improvement A) feed into the fallback strategy as a task failure. The reflection retry counts as one of the `retryCount` same-model retries.
- Downshift chain is configurable but ships with sensible defaults
- Checkpoint is saved before any retry to prevent state loss
- Total attempts per task capped at `retryCount + len(downshiftChain)` to prevent infinite loops

### Non-Goals

- Circuit-breaker pattern or exponential backoff (simple linear chain is sufficient)
- Cross-task downshift (each task starts fresh at the resolved model)

---

## C. Metrics-Informed Suggestions

**Source:** Roxabi Talk 2 (architecture health metrics), Agentic Patterns #18 (Evaluation & Monitoring)
**Affects:** Settings hexagon, Intelligence hexagon

### Problem

The design tracks cost per task but doesn't aggregate metrics or surface actionable recommendations. Users can't tell if their model routing is suboptimal or if certain task types consistently fail.

### Design

Track per-task execution metrics. Surface recommendations via `/tff:settings` but never auto-adjust. Human stays in control.

**TaskMetrics schema (replaces `CostEntrySchema` from base spec with a richer structure — `CostEntrySchema` is deprecated):**

```typescript
export const TaskMetricsSchema = z.object({
  taskId: IdSchema,
  sliceId: IdSchema,
  milestoneId: IdSchema,
  model: z.object({
    provider: z.string(),
    modelId: z.string(),
    profile: ModelProfileNameSchema,
  }),
  tokens: z.object({
    input: z.number().int(),
    output: z.number().int(),
  }),
  costUsd: z.number(),
  durationMs: z.number().int(),
  success: z.boolean(),
  retries: z.number().int().default(0),
  downshifted: z.boolean().default(false),
  reflectionPassed: z.boolean().optional(),
  timestamp: TimestampSchema,
});
```

**Suggestions surfaced in `/tff:settings`:**

```
Model Routing Suggestions (based on last 50 tasks):
  - budget tasks have 92% success rate — current routing is optimal
  - F-lite tasks using balanced have 3.2s avg — consider downshifting to budget (saves ~40%)
  - 3 tasks required downshift from quality → balanced — quality model may be overprovisioned for this project
```

**Implementation:**
- `AggregateMetricsUseCase` in Intelligence hexagon reads from journal
- Recommendations are computed on-demand (not stored), displayed as advisory text
- No automatic model routing changes

### Non-Goals

- Auto-adjusting model routing based on metrics
- Real-time dashboards (metrics are computed on-demand)

---

## D. Parallel Review Dispatch

**Source:** Agentic Patterns #3 (Parallelization), Roxabi Talk 1 (Fresh Reviewer Principle)
**Affects:** Review hexagon

### Problem

Current `ConductReviewUseCase` describes a "3-stage" review (spec compliance, code quality, security audit). Sequential execution means 3x wall-clock time.

### Design

All 3 reviewers run in parallel. Findings are merged, deduplicated by file+line, and conflicts are flagged for human resolution.

**Updated ConductReviewUseCase flow:**

```
1. Dispatch 3 review agents in parallel:
   - spec-reviewer (checks plan compliance)
   - code-reviewer (checks code quality)
   - security-auditor (checks security)
2. Await all 3 results (Promise.all with per-agent timeout)
3. Merge findings:
   a. Deduplicate by (filePath, lineRange, description similarity)
   b. Take highest severity when duplicates found
   c. Flag contradictions for human review
4. Produce merged Review aggregate
5. Determine verdict: any critical → changes_requested, all approved → approved
```

**Schema addition for merged reviews:**

```typescript
export const MergedReviewPropsSchema = ReviewPropsSchema.extend({
  sourceReviews: z.array(z.object({
    role: ReviewRoleSchema,
    verdict: ReviewVerdictSchema,
    findingCount: z.number().int(),
  })),
  conflicts: z.array(z.object({
    finding1: z.object({ role: ReviewRoleSchema, description: z.string() }),
    finding2: z.object({ role: ReviewRoleSchema, description: z.string() }),
    resolution: z.enum(['pending', 'human-resolved']).default('pending'),
  })).default([]),
});
```

**Fresh-reviewer constraint:**
- Each reviewer agent identity must differ from the executor agent identity
- Reviewer agents are independent sessions (not the same agent reviewing 3 times)

### Constraints

- Per-agent timeout: configurable, default 5 minutes
- If one reviewer times out, the others' results are still used (degraded but not blocked)
- ~3x faster wall-clock time than sequential

### Non-Goals

- Consensus-based verdicts or voting among reviewers
- Reviewers negotiating with each other (contradictions go to the human)

---

## E. 5-Level Tiered Memory

**Source:** Agentic Patterns #8 (Memory Management — 5-level architecture)
**Affects:** Intelligence hexagon

### Problem

Current design has observations and skills but no structured memory hierarchy. Context window stuffing is implicit (whatever fits). No session-level or episodic memory.

### Design

Five memory levels, with journal.jsonl as the unified backbone:

| Level | Name | Scope | Storage | Retention |
|---|---|---|---|---|
| L0 | Working | Single agent turn | Context window | Ephemeral |
| L1 | Session | Single task/dispatch | Checkpoint | Until slice closes |
| L2 | Episodic | Cross-task observations | journal.jsonl + SQLite | Until milestone closes |
| L3 | Semantic | Extracted patterns | SQLite (patterns table) | Permanent (with decay) |
| L4 | Procedural | Refined skills | Skill files + SQLite | Permanent |

**New Memory aggregate in Intelligence hexagon:**

```typescript
export const MemoryLevelSchema = z.enum(['working', 'session', 'episodic', 'semantic', 'procedural']);

export const MemoryKindSchema = z.enum(['observation', 'pattern-reference', 'session-summary', 'skill-reference']);

export const MemoryEntrySchema = z.object({
  id: IdSchema,
  level: MemoryLevelSchema,
  kind: MemoryKindSchema,
  content: z.string(),
  source: z.object({
    taskId: IdSchema.optional(),
    sliceId: IdSchema.optional(),
    milestoneId: IdSchema.optional(),
  }),
  relevanceScore: z.number().min(0).max(1).default(1),
  createdAt: TimestampSchema,
  accessedAt: TimestampSchema,
  accessCount: z.number().int().default(0),
});
```

**Promotion flow:**

```
L0 (context window) — agent works, observations accumulate
  ↓ task completes
L1 (session checkpoint) — key observations persisted to checkpoint
  ↓ pattern detected across tasks
L2 (episodic) — cross-task observations stored in journal + SQLite
  ↓ n-gram extraction finds recurring pattern
L3 (semantic) — pattern extracted and scored
  ↓ pattern meets skill creation threshold
L4 (procedural) — skill created/refined
```

**Context injection strategy:**
- L4 skills: injected in system prompt (current behavior)
- L3 patterns: injected as "hints" section in task prompt (top 3 by relevance)
- L2 episodic: available on-demand via a `memory-recall` tool
- L1 session: loaded from checkpoint on resume
- L0 working: managed by the agent runtime (no TFF involvement)

### Integration with existing auto-learn pipeline

The existing auto-learn pipeline (ExtractNgrams → RankCandidates → CreateSkill → RefineSkill) operates on L2→L3→L4 transitions. This improvement formalizes the levels and adds L0/L1 which were previously implicit.

### Non-Goals

- Vector DB or embedding-based retrieval at any tier
- Cross-project memory sharing (memory is per-project)

---

## F. Journal as Unified Transaction Log

**Source:** Hive Architecture (Kafka as nucleus), Agentic Patterns #8 (Memory Management)
**Affects:** Journal schema, Intelligence hexagon

### Problem

The journal is currently designed for crash recovery only. The Hive pattern shows that a unified transaction log can serve as the backbone for multiple consumers (memory, analytics, drift detection) without adding separate event stores.

### Design

Elevate `journal.jsonl` from crash-recovery log to first-class event backbone. Intelligence hexagon has tiered consumers reading from it.

**Expanded journal entry types:**

```typescript
// Add to existing JournalEntrySchema discriminated union:
z.object({ type: z.literal('observation-recorded'), observationId: IdSchema, category: z.string(), content: z.string(), sliceId: IdSchema, timestamp: TimestampSchema }),
z.object({ type: z.literal('pattern-detected'), patternId: IdSchema, description: z.string(), evidence: z.array(IdSchema), timestamp: TimestampSchema }),
z.object({ type: z.literal('skill-refined'), skillId: IdSchema, skillName: z.string(), driftPct: z.number(), timestamp: TimestampSchema }),
z.object({ type: z.literal('task-retried'), taskId: IdSchema, sliceId: IdSchema, model: z.string(), attempt: z.number(), timestamp: TimestampSchema }),
z.object({ type: z.literal('model-downshifted'), taskId: IdSchema, fromModel: z.string(), toModel: z.string(), reason: z.string(), timestamp: TimestampSchema }),
z.object({ type: z.literal('guardrail-violation'), check: z.string(), details: z.string(), sliceId: IdSchema, timestamp: TimestampSchema }),
z.object({ type: z.literal('drift-scan-completed'), milestoneId: IdSchema, findings: z.number().int(), timestamp: TimestampSchema }),
z.object({ type: z.literal('metrics-snapshot'), sliceId: IdSchema, summary: z.object({ totalTokens: z.number(), totalCost: z.number(), taskCount: z.number(), successRate: z.number() }), timestamp: TimestampSchema }),
```

**Consumer architecture:**

```
journal.jsonl (append-only)
  ├── Recovery consumer (existing): replays entries to reconstruct state
  ├── Memory consumer (new): promotes observations through L0→L4 tiers
  ├── Metrics consumer (new): aggregates TaskMetrics for suggestions
  └── Drift consumer (new): feeds DriftReport at milestone boundaries
```

**Implementation:**
- Consumers are registered in the Intelligence hexagon as `JournalConsumerPort` implementations
- Each consumer tracks its own read offset (stored in SQLite)
- Consumers are invoked on-demand (not real-time streaming) — triggered by use cases that need the data
- Journal remains append-only, idempotent-replayable

### Constraints

- Journal file format unchanged (JSONL, one entry per line)
- No real-time streaming — consumers process on-demand
- Consumer offsets stored in SQLite to avoid re-processing

---

## G. Full Guardrails (Pre/Post-Dispatch Validation)

**Source:** Agentic Patterns #17 (Guardrails), Roxabi Talk 3 (scope enforcement)
**Affects:** Execution hexagon

### Problem

The current design has no systematic pre-dispatch or post-dispatch validation. Agents could work on wrong files, exceed scope, or introduce linting violations that compound across tasks.

### Design

Two-phase guardrail system: pre-dispatch (scope + state validation) and post-dispatch (output validation).

**GuardrailPort:**

```typescript
export const GuardrailCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  message: z.string().optional(),
  severity: z.enum(['blocker', 'warning']),
});

export const GuardrailReportSchema = z.object({
  phase: z.enum(['pre-dispatch', 'post-dispatch']),
  checks: z.array(GuardrailCheckSchema),
  allPassed: z.boolean(),
  timestamp: TimestampSchema,
});

export abstract class GuardrailPort {
  abstract runPreDispatch(context: PreDispatchContext): Promise<GuardrailReport>;
  abstract runPostDispatch(context: PostDispatchContext): Promise<GuardrailReport>;
}
```

**Pre-dispatch checks:**

| Check | What it validates |
|---|---|
| Scope containment | Task's `filePaths` ⊆ slice's declared scope |
| Worktree state | Correct worktree checked out, clean state |
| No uncommitted changes | Working directory has no uncommitted modifications |
| Budget check | Remaining budget sufficient for estimated task cost |

**Post-dispatch checks:**

| Check | What it validates |
|---|---|
| File containment | Changed files ⊆ task's declared `filePaths` |
| No rogue files | No unexpected files created outside scope |
| Biome lint | `biome check` passes on changed files |
| Tests pass | `vitest run` passes for affected test files |
| No secrets | No `.env`, credentials, or API keys in diff |
| File size | No file exceeds 500 lines |

**Failure handling:**

```
Pre-dispatch blocker → task not dispatched, escalate
Post-dispatch blocker → auto-retry with guardrail feedback injected into prompt (1 retry)
Post-dispatch warning → record in journal, proceed
Second post-dispatch failure → escalate to human
```

**Journal integration:** `guardrail-violation` entry type (canonical definition in Improvement F).

### Constraints

- Guardrail checks are configurable (can disable individual checks in settings)
- Post-dispatch auto-retry injects the specific guardrail failure message into the retry prompt
- Max 1 auto-retry per guardrail failure (not infinite loops)

---

## H. Architecture Drift Detection

**Source:** Roxabi Talk 3 (periodic health metrics), Agentic Patterns #18 (Evaluation & Monitoring)
**Affects:** Intelligence hexagon

### Problem

Architecture drift (growing files, boundary violations, coverage decay) accumulates silently. By the time it's noticed, remediation is expensive. The current design has no automated health scanning.

### Design

Milestone-boundary scan that runs automatically at slice transitions and milestone close. Advisory only — no blocking.

**Triggers:**
- `slice:transition` (any status change)
- `milestone:close`

**DriftReport value object:**

```typescript
export const DriftCheckSchema = z.object({
  name: z.string(),
  status: z.enum(['healthy', 'warning', 'critical']),
  details: z.string(),
  metric: z.number().optional(),
  threshold: z.number().optional(),
});

export const DriftReportSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema,
  sliceId: IdSchema.optional(),
  checks: z.array(DriftCheckSchema),
  overallHealth: z.enum(['healthy', 'warning', 'critical']),
  scannedAt: TimestampSchema,
});
```

**Checks:**

| Check | Metric | Warning | Critical |
|---|---|---|---|
| File size | Lines per file | >400 lines | >500 lines |
| Boundary violations | Imports crossing hexagon walls | Any violation | >3 violations |
| Test coverage delta | % change vs. previous scan | >5% drop | >15% drop |
| Dependency complexity | Circular deps, depth >3 | Any circular dep | Depth >5 |
| Domain leaks | Infrastructure types in domain layer | Any leak | >3 leaks |

**Storage:**
- DriftReport persisted as a value object in the milestone bead (SQLite)
- Summary event written to journal: `drift-scan-completed`
- Warnings surfaced in `/tff:status` output

**Use case:**

```typescript
export class ScanArchitectureDriftUseCase {
  async execute(milestoneId: string, sliceId?: string): Promise<Result<DriftReport, DriftScanError>> {
    // 1. Glob for all .ts files in src/
    // 2. Run each check (file size, imports, coverage, deps, domain leaks)
    // 3. Compute overall health (worst individual check)
    // 4. Persist DriftReport
    // 5. Append journal entry
    // 6. Return report
  }
}
```

### Non-Goals

- Blocking deployments based on drift (advisory only)
- Auto-fixing drift violations
- Real-time continuous scanning (milestone-boundary only)

---

## I. Compressor Notation for Generated Artifacts

**Source:** Roxabi Talk 1 (Token Compression — "Less Tokens, Same Semantics")
**Affects:** All generated artifacts (skills, agents, specs, plans, research docs)

### Problem

Every skill, agent definition, plan, and spec gets loaded into the AI's context window. Verbose natural-language instructions consume tokens rapidly. The Roxabi compressor demonstrates ~60% token savings by rewriting prose into formal logic notation while preserving exact semantics.

### Design

All artifacts that TFF generates and injects into agent context MUST be written in compressed notation. This applies to:

- **Skills** (system prompt injections)
- **Agent definitions** (dispatch configs)
- **Plans** (PLAN.md files)
- **Specs** (SPEC.md files)
- **Research docs** (RESEARCH.md files)
- **Task prompts** (task descriptions sent to agents)

**Notation vocabulary:**

| Symbol | Meaning |
|--------|---------|
| `∀` | for all |
| `∃` | exists |
| `∈` | member of |
| `∧` | and |
| `∨` | or |
| `¬` | not |
| `→` | then / implies |
| `⟺` | if and only if |
| `⇒` | leads to / triggers |
| `⊆` | subset of |
| `\|` | choice separator |

**Compression rules:**

1. Replace prose conditionals with logic symbols: `condition ⇒ action`
2. Collapse multi-line step descriptions into single-line rules
3. Use short section headings: "S0 — Parse" not "Step 1 — Parse Input"
4. Preserve literal tool invocations in backticks (commands are not compressed)
5. Use pipe `|` for choice enumerations
6. Every branch and edge case from the original must survive compression — no information loss
7. Tables and schemas remain uncompressed (already dense)

**Before (15 lines):**

```
## Step 1 — Parse Input

First, look at the arguments. If an issue number is provided
(like #42), fetch the GitHub issue using the gh CLI tool to get
the title and body.

If the issue does not exist, stop execution and inform the user
that the issue was not found.

If free text is provided instead of an issue number, search for
matching issues using the gh issue list command with the search
parameter.
```

**After (5 lines):**

```
## S0 — Parse

#N ⇒ `gh issue view N --json title,body`
¬∃ issue ⇒ halt
Free text ⇒ `gh issue list --search "{text}"`
```

**Example 2 — Complex multi-branch workflow phase (before: 13 lines):**

```
## Phase 3 — Confidence-Gated Auto-Apply

This phase runs before the one-by-one walkthrough. The auto-applied markers will reflect the outcomes.

First, check if the auto-apply queue is empty. If it is, skip directly to Phase 4.

For every finding in the auto-apply queue that was only flagged by a single agent, we need to spawn a fresh verifier agent from a different domain. If the verifier confirms the finding with confidence above the threshold, it stays in the queue and we mark it as verified by two agents. If the verifier rejects it or lowers confidence below threshold, move it to the one-by-one queue instead.

If there are more than 5 findings in the queue, ask the user whether to auto-apply all of them or review each one individually via the walkthrough.

Then apply each finding sequentially. If a finding succeeds, mark it as applied. If it fails because of a test failure, lint error, timeout, or crash, restore the stash, demote that finding plus all remaining findings to the walkthrough queue, add a note about the failure, and stop the serial apply. Prior successful fixes are not rolled back.

Finally, display a summary of what was applied and what was demoted before continuing to Phase 4.
```

**After (12 lines, ~55% token reduction):**

```
## P3 — Auto-Apply (C ≥ T)

Q_auto = ∅ ⇒ skip → P4

∀ f ∈ Q_auto ∧ |A(f)| = 1:
  spawn verifier(¬src(f))
  C(f) ≥ T ⇒ stays, |A(f)| := 2
  C(f) < T ∨ rejects ⇒ Q_1b1

|Q_auto| > 5 ⇒ AskUserQuestion:
  Auto-apply all | Review via 1b1

∀ f ∈ Q_auto (sequential):
  ✓ ⇒ [applied]
  ✗ (test|lint|timeout|crash) ⇒
    stash restore → f + remaining → Q_1b1
    ¬halt prior fixes

Summary → P4
```

**Implementation:**
- Skill `compress-artifacts` added to the Intelligence hexagon's skill set
- Injected into the system prompt of any agent that generates artifacts (planning, research, discussing phases)
- Post-generation guardrail (Improvement G) can optionally validate compression ratio
- Existing verbose artifacts are compressed lazily (on next edit, not bulk migration)

**Compression targets:**
- Skills: ~60% token reduction
- Plans: ~50% token reduction (tables/schemas stay verbose)
- Specs: ~40% token reduction (schemas dominate, prose sections compress)
- Task prompts: ~30% token reduction (shorter, already somewhat terse)

### Non-Goals

- Compressing schemas or code blocks (already dense)
- Compressing user-facing output (only context-window-injected artifacts)
- Requiring humans to read compressed notation (human-facing docs stay verbose)

---

## Impact on Milestones

These improvements integrate into the existing milestone plan:

| Milestone | Additions |
|---|---|
| M03 (Execution & Recovery) | A (reflection), B (fallback chain), G (guardrails), I (compressor — skill + guardrail) |
| M04 (Review & Ship) | D (parallel review dispatch) |
| M05 (Intelligence & Auto-Learn) | C (metrics suggestions), E (tiered memory), F (journal consumers), H (drift detection) |
| M06 (Team & Polish) | No changes |

No new milestones required. Improvements are additive to existing hexagons and don't change architectural boundaries.

---

## Acceptance Criteria

1. **A (Reflection):** After task completion, agent self-reviews diff against acceptance criteria. Blockers trigger retry. Warnings are recorded.
2. **B (Fallback):** Failed tasks retry same model, then downshift, then escalate. Checkpoint saved before each retry.
3. **C (Metrics):** `/tff:settings` displays aggregated metrics and advisory suggestions. No auto-adjustment.
4. **D (Parallel Review):** 3 reviewers dispatch in parallel. Findings merged and deduplicated. Contradictions flagged.
5. **E (Memory):** 5 memory levels with promotion flow. L3/L4 injected into prompts. L2 available via tool.
6. **F (Journal):** journal.jsonl serves recovery, memory, metrics, and drift consumers. Consumer offsets tracked.
7. **G (Guardrails):** Pre-dispatch validates scope/state. Post-dispatch validates output. Violations auto-retry once with feedback.
8. **H (Drift):** Milestone-boundary scan produces DriftReport. Warnings in `/tff:status`. Advisory only.
9. **I (Compressor):** All generated artifacts (skills, plans, specs, research, task prompts) use formal logic notation. ~40-60% token reduction vs. verbose prose. Schemas/code uncompressed.

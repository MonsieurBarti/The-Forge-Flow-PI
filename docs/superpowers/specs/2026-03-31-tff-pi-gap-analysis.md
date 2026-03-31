# TFF-PI Gap Analysis: External Comparison + Proposed Additions

> Source: `tff-pi-analysis.md` (comparison against TFF v0.7.0, Valora v2.3.0, roxabi-plugins/dev-core) + user input

---

## 1. Already Covered by Existing Plans

These items from the analysis are **already planned** -- no action needed:

| Analysis Recommendation | Covered By |
|---|---|
| Escalation detection | M03-S02 (autonomy modes + escalation) |
| Complexity tier routing | M03-S01 (WorkflowSession with tier guards) |
| Skill loading rules | M03-S04 (context staging area, skill injection per phase) |
| Model downshift fallback | Design improvement B (retry -> downshift -> escalate) |
| Per-task reflection | Design improvement A (same agent re-reads diff + ACs) |
| Guardrails (pre/post-dispatch) | M04-S08 + Design improvement G |
| Cost tracking / metrics | M04-R06 + Design improvement C (metrics-informed suggestions) |
| 5-level tiered memory | Design improvement E (L0-L4) |
| Journal as event backbone | Design improvement F |
| Architecture drift detection | Design improvement H |
| Fresh-reviewer enforcement | M05-R02 |
| Auto-learn pipeline | M06 (full milestone dedicated to this) |

---

## 2. Genuine Gaps -- Proposed Additions

### From Valora Comparison

#### G01: Stage Output Caching with TTL

**What:** TTL-based caching with cache keys per execution stage. Avoid re-running expensive stages (research, review) when inputs haven't changed.

**Why Valora does it:** Stage outputs (research results, review findings) are expensive. Re-executing a slice after a minor fix shouldn't re-run the full research phase.

**What TFF-PI has today:** Checkpoint is per-wave with no invalidation logic. Resume replays from last completed wave but doesn't cache stage artifacts intelligently.

**Proposal:** Add cache-key computation per phase (hash of inputs: files, spec, settings). On resume/re-execute, skip stages whose inputs haven't changed. TTL configurable per stage type. Invalidation on file changes within scope.

**Suggested milestone:** M07 or M08

---

#### G02: Failure Policy Model (strict / tolerant / lenient)

**What:** Per-stage configurable failure behavior instead of uniform fail-fast.

**Why Valora does it:** Research can tolerate partial failures (some sources unreachable). Execution should be strict (test failures block). Review can be lenient on minor findings.

**What TFF-PI has today:** Design improvement B handles model downshift on failure, but no per-stage policy. Current behavior: fail -> retry -> escalate uniformly.

**Proposal:** Add `failurePolicy` to WorkflowSession phase config:
- `strict`: any failure blocks progression (execution, security review)
- `tolerant`: continues on non-critical failures, records them (research, code review minors)
- `lenient`: best-effort, logs warnings (suggestions, pattern detection)

Configurable per phase in `settings.yaml`.

**Suggested milestone:** M07

---

#### G03: Richer Per-Stage Quality Metrics

**What:** Track structured quality signals per stage: lint error count, test pass/fail/skip counts, tool invocation failures, review score breakdown.

**Why Valora does it:** `QualityMetrics` per stage enables trend analysis, identifies degrading stages, informs auto-suggestions.

**What TFF-PI has today:** Design improvement C tracks `TaskMetrics` (success rate, token usage, downshift frequency) but not per-stage quality signals.

**Proposal:** Extend metrics schema with per-stage `QualitySnapshot`:
- `lintErrors`, `testsPassed`, `testsFailed`, `testsSkipped`
- `toolInvocations`, `toolFailures`
- `reviewScore` (aggregate from findings)
- `filesChanged`, `linesAdded`, `linesRemoved`

Feed into metrics-informed suggestions (improvement C).

**Suggested milestone:** M05 (alongside review) or M07

---

### From dev-core Comparison

#### G04: Stack Auto-Discovery

**What:** Runtime detection of project tech stack (languages, frameworks, package managers, test runners, linters) instead of manual `settings.yaml`.

**Why dev-core does it:** `stack.yml` auto-discovered at runtime eliminates manual setup friction. TFF's `settings.yaml` requires users to configure everything.

**What TFF-PI has today:** Static `settings.yaml` with manual configuration.

**Proposal:** Add `DiscoverStackUseCase` that scans project root for:
- `package.json` -> Node/TS, detect framework from deps
- `Cargo.toml` -> Rust
- `pyproject.toml` / `requirements.txt` -> Python
- `go.mod` -> Go
- Linters: `.eslintrc`, `biome.json`, `.prettierrc`
- Test runners: vitest config, jest config, pytest
- CI: `.github/workflows/`, `.gitlab-ci.yml`

Auto-populate `settings.yaml` defaults on `tff init`. Override stack detection in settings.

**Suggested milestone:** M07

---

#### G05: Hook-Based Early Guardrails

**What:** Pre-tool-use and post-tool-use hooks that intercept agent actions before they execute, catching violations earlier than post-dispatch guardrails.

**Why dev-core does it:** `PreToolUse` hooks block secrets from being written and auto-format code before it lands. Catching at tool level is cheaper than catching after full task completion.

**What TFF-PI has today:** Design improvement G adds pre/post-dispatch guardrails at the execution level. But these run before/after entire task dispatch, not at individual tool invocation granularity.

**Proposal:** Add hook injection into agent dispatch config:
- `preToolUse` hooks: validate tool arguments (block `rm -rf`, detect secrets in write content, enforce file scope)
- `postToolUse` hooks: auto-format on file write, lint check on file write, log tool invocation for observations
- Hooks defined per-project in settings, not hardcoded
- PI SDK may already support this via extension hooks -- leverage if available

**Suggested milestone:** M04 (extends guardrails work) or M07

---

#### G06: Richer Init/Setup Chain

**What:** Multi-step project initialization beyond `/tff:new`: environment validation, CI scaffolding.

**Why dev-core does it:** `/init` -> `/env-setup` -> `/ci-setup` is a guided chain that gets projects production-ready faster.

**What TFF-PI has today:** `/tff:new` creates project + first milestone. No CI, no env validation.

**Proposal:** Add setup sub-commands or extend `/tff:new` with optional steps:
- `/tff:new` -- project + milestone (existing)
- `/tff:env-check` -- validate Node version, git config, required tools
- `/tff:ci-setup` -- scaffold GitHub Actions workflow for TFF (lint, test, PR checks)

**Suggested milestone:** M08

---

### From User's Ideas

#### G07: Shared Memory Per Project

**What:** Persistent, project-scoped knowledge store that persists across ALL sessions and agents for a given project. Distinct from the L0-L4 tiered memory (which is per-agent-session promotion flow).

**Why:** Currently, each agent session starts with a clean context window. Knowledge discovered in one session (architectural decisions, gotchas, domain conventions) is lost. The 5-level tiered memory (improvement E) promotes observations within a session's lifecycle, but doesn't provide a shared persistent project memory.

**What TFF-PI has today:** L0-L4 tiered memory is planned (improvement E) but oriented toward observation -> pattern -> skill promotion. No explicit shared knowledge base that agents can read/write across sessions.

**Proposal:** Add a `ProjectMemoryPort` with:
- Key-value store scoped to project (stored in `.tff/memory/` or SQLite)
- Read/write from any agent session
- Categories: `architecture-decisions`, `domain-conventions`, `gotchas`, `resolved-bugs`
- Auto-populated from successful task completions (links to R06 knowledge base in M06)
- Injected into agent context based on relevance (file paths, hexagon, phase)
- Synced via state branches (per-branch persistence spec)
- Eviction: LRU with configurable max entries, staleness detection

**Suggested milestone:** M06 (alongside intelligence hexagon) or M07

---

#### G08: CQ Integration (Shared Agent Knowledge Commons)

**What:** Integration with [mozilla-ai/cq](https://github.com/mozilla-ai/cq) -- a shared knowledge store that helps agents avoid known pitfalls across projects and teams.

**Why:** Auto-learn (M06) captures patterns within TFF-PI projects. CQ extends this to cross-project and cross-team knowledge. When one agent discovers a non-obvious solution, all future agents benefit.

**What TFF-PI has today:** M06 pattern detection is project-scoped. No cross-project knowledge sharing.

**Proposal:** Add `CqKnowledgeAdapter` implementing a `SharedKnowledgePort`:
- **Query** CQ before unfamiliar work (APIs, build tools, frameworks) -- inject relevant knowledge into agent context
- **Propose** when an agent discovers something non-obvious during execution
- **Confirm** when CQ guidance proves correct
- **Flag** when CQ guidance was wrong or stale
- Integration points:
  - Research phase: query CQ for domain knowledge
  - Post-execution: propose learnings from successful completions
  - Post-review: confirm/flag CQ guidance used during execution
- CQ already has an MCP server (plugin:cq:cq) -- leverage existing protocol

**Suggested milestone:** M07 or M08

---

#### G09: Configurable Tool/Command Rules Per Agent

**What:** Declarative rules governing which tools and commands each agent/tier is allowed to use, similar to Claude Code's `settings.json` `allowedTools` and `permissions`.

**Why:** Different tiers and agents need different permission scopes. An S-tier quick fix shouldn't have access to destructive git commands. A security auditor shouldn't be able to write files. Currently, all agents get the same tool set.

**What TFF-PI has today:** Guardrails (M04-S08 + improvement G) validate outputs post-dispatch. No pre-dispatch tool scoping per agent role or complexity tier.

**Proposal:** Add `ToolPolicySchema` to settings:
```yaml
toolPolicies:
  defaults:
    blocked: [Bash:rm -rf, Bash:git push --force]
  byTier:
    S:
      allowed: [Read, Edit, Write, Bash, Grep, Glob]
      blocked: [Agent]  # S-tier doesn't spawn sub-agents
    F-full:
      allowed: [*]
  byRole:
    security-auditor:
      allowed: [Read, Grep, Glob, Bash:grep, Bash:git]
      blocked: [Write, Edit]  # read-only reviewer
    executor:
      allowed: [*]
      blocked: [Bash:git push, Bash:git rebase]
```

Enforced at dispatch time via tool filtering in `AgentDispatchConfigSchema`.

**Suggested milestone:** M04 (extends guardrails) or M07

---

### Additional Gaps Identified

#### G10: Code Intelligence (AST/LSP)

**What:** Tree-sitter AST parsing and/or LSP integration for semantic code understanding.

**Why Valora has it:** Semantic understanding enables smarter file scoping, dependency analysis, and targeted review.

**What TFF-PI has today:** File-path based domain routing (if path contains `src/domain/` -> load hexagonal-architecture skill). No semantic analysis.

**Proposal:** Add optional `CodeIntelligencePort`:
- Tree-sitter parsing for supported languages (TS, Rust, Python, Go)
- Extract: imports, exports, class/function definitions, dependency graph
- Use cases: smarter task file scoping, impact analysis for changes, review scope

**Consideration:** Heavy dependency. Could be optional adapter.

**Suggested milestone:** M07

---

#### G11: CI/CD Integration

**What:** Native CI/CD pipeline integration (GitHub Actions, GitLab CI) for automated TFF workflows.

**Why dev-core has it:** Automated checks on PR, pre-commit hooks, CI-triggered review runs.

**What TFF-PI has today:** No CI/CD integration.

**Proposal:** Add CI workflow templates:
- GitHub Actions: run TFF verify on PR, run TFF review on PR, status checks
- Pre-commit hooks: lint, format, boundary check (Biome)
- Optional: TFF-triggered CI runs (after execution, before ship)

**Suggested milestone:** M08

---

## 3. Priority Ranking

| Priority | Gap | Impact | Effort | Milestone |
|---|---|---|---|---|
| **P1** | G09: Tool/command rules per agent | High (security, discipline) | Medium | M04/M07 |
| **P1** | G04: Stack auto-discovery | High (onboarding friction) | Medium | M07 |
| **P1** | G07: Shared memory per project | High (cross-session learning) | Medium | M06/M07 |
| **P2** | G02: Failure policy model | Medium (execution resilience) | Low | M07 |
| **P2** | G05: Hook-based early guardrails | Medium (catch violations earlier) | Medium | M04/M07 |
| **P2** | G08: CQ integration | Medium (cross-project learning) | Low | M07/M08 |
| **P2** | G03: Per-stage quality metrics | Medium (observability) | Low | M05/M07 |
| **P3** | G01: Stage output caching | Medium (perf optimization) | Medium | M07/M08 |
| **P3** | G06: Richer init/setup chain | Low (convenience) | Low | M08 |
| **P3** | G10: Code intelligence | Medium (semantic understanding) | High | M07 |
| **P3** | G11: CI/CD integration | Medium (automation) | Medium | M08 |

---

## 4. Suggested Milestone Allocation

### M07: Team Collaboration and Polish (expand scope)
- G04: Stack auto-discovery
- G02: Failure policy model
- G07: Shared memory per project
- G03: Per-stage quality metrics
- G09: Tool/command rules (if not in M04)
- G10: Code intelligence (AST/LSP)

### M08: Expansion (fill the empty stub)
- G08: CQ integration
- G01: Stage output caching
- G05: Hook-based early guardrails
- G06: Richer init/setup chain
- G11: CI/CD integration

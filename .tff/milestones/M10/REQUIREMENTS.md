# M10: Expansion -- External Integrations and Automation

## Goal

Extend TFF-PI with external integrations (CQ knowledge commons, hook-based guardrails), developer experience improvements (richer init, stage caching), and CI/CD automation.

## Requirements

### R01: CQ Integration -- Shared Agent Knowledge Commons (Gap G08)

- `CqKnowledgeAdapter` implementing `SharedKnowledgePort`
- Operations:
  - **Query** CQ before unfamiliar work (APIs, build tools, frameworks) -- inject relevant knowledge into agent context
  - **Propose** when an agent discovers something non-obvious during execution
  - **Confirm** when CQ guidance proves correct
  - **Flag** when CQ guidance was wrong or stale
- Integration points:
  - Research phase: query CQ for domain knowledge
  - Post-execution: propose learnings from successful completions
  - Post-review: confirm/flag CQ guidance used during execution
- Leverages existing MCP server protocol (plugin:cq:cq)
- Cross-project and cross-team knowledge sharing (complements M07 project-scoped auto-learn)

**AC:**
- CQ queried during research phase
- Learnings proposed after successful task completion
- Wrong guidance flagged (not silently ignored)
- Works with CQ MCP server

### R02: Stage Output Caching with TTL (Gap G01)

- Cache-key computation per phase: hash of inputs (files, spec, settings)
- On resume/re-execute: skip stages whose inputs haven't changed
- TTL configurable per stage type in settings
- Invalidation: on file changes within scope, on settings change, on manual override
- Particularly valuable for research and review stages (expensive, often unchanged on retry)

**AC:**
- Cache hit skips stage re-execution
- TTL respected (stale cache invalidated)
- Manual override available (`--no-cache` flag)

### R03: Hook-Based Early Guardrails (Gap G05)

- Pre-tool-use and post-tool-use hooks at individual tool invocation granularity
- `preToolUse` hooks: validate tool arguments before execution
  - Block `rm -rf` and other dangerous commands
  - Detect secrets in write content
  - Enforce file scope (write only within task's declared files)
- `postToolUse` hooks: process tool results after execution
  - Auto-format on file write (if formatter configured via stack discovery)
  - Lint check on file write
  - Log tool invocation for observation system (feeds M07 auto-learn)
- Hooks defined per-project in settings (not hardcoded)
- Investigate PI SDK extension hooks -- leverage if available
- Complements M04 R08/R13 (dispatch-level guardrails) with finer-grained interception

**AC:**
- Secrets blocked before write reaches disk
- File scope enforced per tool call (not just per task)
- Hooks configurable per-project

### R04: Richer Init/Setup Chain (Gap G06)

- `/tff:env-check` -- validate runtime prerequisites:
  - Node version (>= required)
  - Git version and config (user.name, user.email)
  - Required tools available (git, tff, optional: tree-sitter)
  - Report missing/outdated with actionable fix instructions
- `/tff:ci-setup` -- scaffold CI pipeline:
  - GitHub Actions workflow for TFF (lint, test, PR checks)
  - Pre-commit hooks (lint, format, boundary check via Biome)
  - Template-based, customizable

**AC:**
- Env check reports all issues in one pass (not fail-fast)
- CI scaffold produces working GitHub Actions workflow
- Templates customizable via settings

### R05: CI/CD Integration (Gap G11)

- GitHub Actions workflow templates:
  - Run `tff verify` on PR (acceptance criteria validation)
  - Run `tff review` on PR (automated code review)
  - Status checks block merge until passing
- Pre-commit hooks:
  - Biome lint + format
  - Hexagon boundary check
- Optional: TFF-triggered CI runs (after execution, before ship)
- Configurable: which checks run, which block merge

**AC:**
- CI workflow passes on well-formed PRs
- Status checks integrated with GitHub branch protection
- Hooks installable via `/tff:ci-setup` (R04)

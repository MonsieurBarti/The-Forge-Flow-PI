# M05: Review and Ship

## Goal

Build the review hexagon with fresh-reviewer enforcement, multi-stage review pipeline, and the ship workflow for PR creation and merge.

## Requirements

### R01: Review Hexagon -- Entity and Schemas

- `Review` aggregate with `ReviewPropsSchema` (id, sliceId, role, agentIdentity, verdict, findings, createdAt)
- `ReviewVerdictSchema`: approved, changes_requested, rejected
- `ReviewRoleSchema`: code-reviewer, spec-reviewer, security-auditor
- Findings: severity (critical, high, medium, low, info), message, filePath, lineStart, lineEnd
- `recordFindings()` business method
- `ReviewRepositoryPort`, SQLite + in-memory adapters
- `ReviewBuilder`

**AC:**
- Review entity captures structured findings (not free-form text)
- All severity levels enforced via Zod schema

### R02: Fresh-Reviewer Enforcement

- `enforceFreshReviewer()`: reviewer agent !== executor agent for that slice
- `ExecutorQueryPort` (cross-hexagon port): queries Execution hexagon for who executed a slice
- `FreshReviewerViolationError` when constraint violated

**AC:**
- Self-review is impossible (hard error, not warning)
- Cross-hexagon query goes through port (not direct import)

### R03: Multi-Stage Review Pipeline (Parallel -- Design Improvement D)

- `ConductReviewUseCase`: 3 reviewers dispatch in **parallel** (Promise.all with per-agent timeout)
  1. Spec compliance (spec-reviewer, quality model): acceptance criteria vs implementation -> PASS/FAIL
  2. Code quality (code-reviewer, quality model): patterns, YAGNI, tests, readability -> APPROVE/CHANGES_REQUESTED
  3. Security audit (security-auditor, quality model): OWASP/STRIDE -> critical/high blocks PR
- Findings merged: deduplicate by (filePath, lineRange, description similarity), take highest severity on duplicates, flag contradictions for human
- `MergedReviewPropsSchema`: extends ReviewPropsSchema with sourceReviews and conflicts arrays
- Each reviewer is a fresh independent session (not same agent reviewing 3 times)
- Per-agent timeout: configurable, default 5 minutes; timeout of one reviewer doesn't block others
- CHANGES_REQUESTED spawns fixer agent -> loop until APPROVE (max 2 cycles)
- Verdict: any critical -> changes_requested; all approved -> approved

**AC:**
- All 3 reviewers run in parallel (~3x faster wall-clock)
- Findings merged and deduplicated by file+line
- Contradictions flagged for human (not auto-resolved)
- Security audit runs on every PR (not optional)
- Fixer loop respects max retries
- Partial timeout is degraded but not blocked

### R04: Critique-then-Reflection Review

- Two-pass review pattern:
  1. First pass: identify ALL issues (exhaustive, no prioritization)
  2. Second pass: meta-analyze, prioritize by impact, synthesize actionable feedback
- Applied during code quality review stage
- Prevents superficial reviews that miss systemic issues

**AC:**
- Two-pass output is structured (not a single blob)
- Priority ranking reflects actual impact (not just severity)

### R05: Review UI Port

- `ReviewUIPort` abstract class (presentFindings, presentForApproval)
- Default adapter: terminal (pi-tui based)
- Optional: plannotator PI extension (auto-detected if available)
- Used for: plan approval, verification results, review findings

**AC:**
- Terminal adapter works without plannotator
- Plannotator detected and used when available

### R06: Agent Authoring Protocol

- Agents are identity-only (<= 30 lines)
- ALL methodology lives in skills (loaded via skill injection)
- Agent template: name, model, identity, purpose, skills loaded, fresh-reviewer rule, scope
- Only create agents when fresh-reviewer enforcement requires persistent identity

**AC:**
- No methodology in agent files
- Agent files follow standardized template

### R07: Receiving Code Review (Fixer Behavior)

- Per finding: UNDERSTAND -> VERIFY -> EVALUATE -> IMPLEMENT
- Wrong finding -> push back with evidence (not blind implementation)
- Run tests after every accepted change
- Critical/Important -> must address; Minor -> may defer with justification

**AC:**
- Fixer doesn't blindly implement all suggestions
- Test suite runs after each change
- Push-back on incorrect findings is logged

### R08: Verification Command (`/tff:verify`)

- Validate acceptance criteria: binary verdict per criterion (PASS/FAIL, no "partially met")
- READ -> RUN -> EVIDENCE -> VERDICT per criterion
- "If you didn't run the command in this session, you cannot claim it passes"
- Forbidden language: "should work", "probably passes", "I believe this is correct"
- Use separate evaluator model (or different persona) from generator to avoid self-validation bias

**AC:**
- Every criterion has explicit evidence (command output, test results)
- No subjective assessments accepted
- Evaluator is distinct from the agent that did the work

### R09: Ship Command (`/tff:ship`)

- Create PR (slice branch -> milestone branch) via GitHub port
- tff NEVER merges -- only creates PRs
- PR URL always shown to user
- Merge gate via user interaction: "PR merged" or "PR needs changes"
- On merge: close slice, delete worktree, delete slice branch (local + remote), rebase milestone branch
- `ReviewRecordedEvent` domain event

**AC:**
- PR created with structured body (summary, test plan)
- Merge is human-only action
- Cleanup happens automatically after confirmed merge

### R10: Complete Milestone (`/tff:complete-milestone`)

- Guard: all slices must be closed
- Milestone audit against original intent
- Create PR (milestone branch -> main)
- On merge: delete milestone branch (local + remote)

**AC:**
- Cannot complete milestone with open slices
- Audit report generated before PR creation

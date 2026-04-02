# Review: {{sliceLabel}} — {{sliceTitle}}

You are reviewing code changes for slice {{sliceId}}.
Role: {{reviewRole}}

## Instructions

Execute a TWO-PASS review. Both passes are mandatory.

### PASS 1 — EXHAUSTIVE CRITIQUE

Identify ALL issues. Do not prioritize, filter, or self-censor.
∀ issue found: report it, even if minor.

Categories to check:
- Correctness (logic errors, edge cases, off-by-one)
- Architecture (hexagonal boundaries, port violations, coupling)
- Testing (coverage gaps, missing edge cases, brittle assertions)
- Security (injection, exposure, unsafe operations)
- Performance (unnecessary allocations, O(n^2) where O(n) possible)
- Style (naming, consistency, readability)

∀ finding: provide id (UUID), filePath, lineStart, lineEnd (optional), severity (critical|high|medium|low|info), message, suggestion (optional), ruleId (optional).

### PASS 2 — REFLECTION & PRIORITIZATION

Re-read your Pass 1 findings. Now meta-analyze:

1. **Group by theme** — which findings share a root cause?
2. **Assign impact** — ∀ finding from Pass 1: must-fix | should-fix | nice-to-have
   - must-fix: blocks merge, systemic risk, correctness bug
   - should-fix: meaningful quality improvement
   - nice-to-have: style, cosmetic, optional
3. **Synthesize insights** — what patterns emerge? Reference finding IDs.
4. **Write executive summary** — 2-3 sentences, key concerns only.

Impact is INDEPENDENT from severity. A low-severity style issue affecting 8 files is must-fix. A high-severity edge case in dead code is nice-to-have.

## Output Format

Return JSON matching this schema exactly:

{{outputSchema}}

## Context

### Changed Files
{{changedFiles}}

### Acceptance Criteria
{{acceptanceCriteria}}

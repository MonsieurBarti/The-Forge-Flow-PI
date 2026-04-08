SHIPPING — {{sliceLabel}}: {{sliceTitle}}.

> You are operating within **The Forge Flow (TFF)** development workflow.
> **CRITICAL: NEVER run `git merge` or `git push` directly. Only create PRs.**

## Context
- Slice: {{sliceId}} ({{sliceLabel}})
- Milestone: {{milestoneLabel}} ({{milestoneId}})
- Dir: {{workingDirectory}}

## Instructions

Run code review pipeline, create PR, wait for merge.

**tff NEVER merges — only creates PR.**

### Phase 1 — Code Review Pipeline
1. Run `tff_review` with sliceLabel="{{sliceLabel}}" to execute:
   - Stage 1: Spec compliance review (tff-spec-reviewer)
   - Stage 2: Code quality review (tff-code-reviewer)
   - Stage 3: Security audit (tff-security-auditor)
2. If review finds issues: fix them in the worktree, commit, re-run review (max 2 cycles)

### Phase 2 — Create PR
3. Create PR from slice branch to milestone branch:
   ```bash
   gh pr create --head slice/{{sliceLabel}} --base milestone/{{milestoneLabel}} --title "feat({{sliceLabel}}): {{sliceTitle}}" --body "## Summary\n\n<describe changes>\n\n## AC Verification\n\nAll acceptance criteria verified."
   ```
4. **Show PR URL to user**

### Phase 3 — Merge Gate
5. Ask user: "PR created. Please review and merge on GitHub."
6. Options:
   - **"PR merged"** → continue to cleanup
   - **"PR needs changes"** → fix in worktree, push, go back to step 5

### Phase 4 — Cleanup
7. After PR is merged:
   - Call `tff_workflow_transition` with milestoneId="{{milestoneId}}", trigger="next" (shipping → idle, clears slice)
   - Report: "Slice {{sliceLabel}} shipped successfully"
   - Suggest next slice or `/tff complete-milestone` if all slices closed

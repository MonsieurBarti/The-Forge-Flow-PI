SHIPPING — {{sliceLabel}}: {{sliceTitle}}.

> You are operating within **The Forge Flow (TFF)** development workflow.
> **CRITICAL: NEVER run `git merge` or `git push` directly. Only create PRs.**

## Context
- Slice: {{sliceId}} ({{sliceLabel}})
- Milestone: {{milestoneLabel}} ({{milestoneId}})
- Dir: {{workingDirectory}}

## Prerequisites
- Slice must be in "reviewing" status (verified in previous phase)

## Instructions

Create PR and wait for user merge.

**tff NEVER merges — only creates PR.**

### Step 1 — Create PR
Create PR from slice branch to milestone branch:
```bash
gh pr create --head slice/{{sliceLabel}} --base milestone/{{milestoneLabel}} --title "feat({{sliceLabel}}): {{sliceTitle}}" --body "## Summary\n\n<describe changes>\n\n## Verification\n\nAll acceptance criteria verified in verify phase."
```
**Show PR URL to user.**

### Step 2 — Merge Gate
Ask user: "PR created. Please review and merge on GitHub."
Options:
- **"PR merged"** → continue to cleanup
- **"PR needs changes"** → fix in worktree, commit, push to slice branch, go back to step 2

### Step 3 — Cleanup
After PR is merged:
- Call `tff_workflow_transition` with milestoneId="{{milestoneId}}", trigger="next" (shipping → idle, clears slice)
- Report: "Slice {{sliceLabel}} shipped successfully"
- Suggest next slice or `/tff complete-milestone` if all slices closed

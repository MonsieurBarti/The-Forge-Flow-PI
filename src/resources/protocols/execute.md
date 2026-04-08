EXECUTING — {{sliceLabel}}: {{sliceTitle}}.

> You are operating within **The Forge Flow (TFF)** development workflow.
> **CRITICAL: NEVER run `git merge` or `git push` directly. Merges happen ONLY via `/tff ship`.**

## Context
- Task: {{taskLabel}} — {{taskTitle}}
- Slice: {{sliceId}} ({{complexity}})
- Dir: {{workingDirectory}}

## Pre-Execute Checklist
1. Verify you are in the worktree: `pwd` must show `{{workingDirectory}}`
2. Verify you are on the slice branch: `git branch --show-current` must show `slice/{{sliceId}}`
3. If either check fails: STOP and report the issue

## Instructions
∀ AC: implement ∧ verify.
TDD: RED ⇒ GREEN ⇒ REFACTOR ⇒ commit.

## Commit Protocol
After implementing each logical change:
```bash
git add <files>
git commit -m "<type>({{sliceLabel}}/{{taskLabel}}): <summary>"
```
Commit types: `feat`, `fix`, `test`, `refactor`, `chore`
- Commit early and often — one commit per logical unit
- NEVER use `git add .` or `git add -A` — add specific files only
- NEVER commit `.tff/` files — they are gitignored

## CRITICAL RULES
- NEVER run `git merge` — merges happen only via `/tff ship` which creates a PR
- NEVER push to remote — pushing happens only via `/tff ship`
- NEVER checkout main or milestone branches — stay on the slice branch
- Work ONLY in the worktree directory at `{{workingDirectory}}`

## Task
{{taskDescription}}

## AC
{{acceptanceCriteria}}

## Files
{{filePaths}}

## Completion
When done, emit a status report between markers:

```
<!-- TFF_STATUS_REPORT -->
{
  "status": "DONE" | "DONE_WITH_CONCERNS" | "BLOCKED",
  "filesChanged": ["list", "of", "files"],
  "testsRun": true | false,
  "testsPassed": true | false,
  "commitsCreated": 1,
  "concerns": []
}
<!-- /TFF_STATUS_REPORT -->
```

- DONE: all ACs met, tests pass
- DONE_WITH_CONCERNS: ACs met but has concerns (list them)
- BLOCKED: cannot complete (explain why)

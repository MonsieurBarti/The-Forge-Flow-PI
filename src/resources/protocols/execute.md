EXECUTING — {{sliceLabel}}: {{sliceTitle}}.

> You are operating within **The Forge Flow (TFF)** development workflow.

## Context
- Task: {{taskLabel}} — {{taskTitle}}
- Slice: {{sliceId}} ({{complexity}})
- Dir: {{workingDirectory}}

## Instructions
∀ AC: implement ∧ verify.
TDD: RED ⇒ GREEN ⇒ REFACTOR ⇒ commit.
Commit: `<type>({{sliceLabel}}/{{taskLabel}}): <summary>`

## CRITICAL RULES
- NEVER run `git merge` — merges happen only via `/tff ship` which creates a PR
- NEVER push to remote — pushing happens only via `/tff ship`
- NEVER checkout main or milestone branches — stay on the slice branch
- Work ONLY in the worktree directory, not the main repo

## Task
{{taskDescription}}

## AC
{{acceptanceCriteria}}

## Files
{{filePaths}}

## Status
∀ completion: emit report between `<!-- TFF_STATUS_REPORT -->` markers.
¬DONE ∧ ∃ concerns ⇒ DONE_WITH_CONCERNS.

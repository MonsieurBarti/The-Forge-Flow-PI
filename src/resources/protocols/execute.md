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

## Task
{{taskDescription}}

## AC
{{acceptanceCriteria}}

## Files
{{filePaths}}

## Status
∀ completion: emit report between `<!-- TFF_STATUS_REPORT -->` markers.
¬DONE ∧ ∃ concerns ⇒ DONE_WITH_CONCERNS.

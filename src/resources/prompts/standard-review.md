# Spec Compliance Review: {{sliceLabel}} — {{sliceTitle}}

**Role:** {{reviewRole}}
**Slice ID:** {{sliceId}}

## Instructions

Review the changed files against the acceptance criteria below. For each criterion, determine whether the implementation satisfies it.

Return your findings as a JSON array of findings. Each finding must have:
- `id`: unique UUID
- `severity`: "critical" | "high" | "medium" | "low" | "info"
- `message`: description of the issue
- `filePath`: path to the affected file
- `lineStart`: starting line number
- `suggestion`: (optional) suggested fix

If all acceptance criteria are met and no issues found, return an empty findings array.

## Changed Files

{{changedFiles}}

## Acceptance Criteria

{{acceptanceCriteria}}

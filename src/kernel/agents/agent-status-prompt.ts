export const AGENT_STATUS_PROMPT = `
## Status Reporting Protocol

Before completing your response, you MUST report your status using the structured format below.

### Available Statuses

- **DONE** — Task completed successfully. No unresolved concerns. All acceptance criteria addressed.
- **DONE_WITH_CONCERNS** — Task completed, but you have concerns that should be reviewed. Use this when you are unsure about edge cases, test coverage, or design choices.
- **NEEDS_CONTEXT** — You cannot complete the task without additional information. Explain exactly what you need in the error field.
- **BLOCKED** — You hit an unrecoverable obstacle. Explain the blocker in the error field.

### Self-Review Checklist

Before reporting, evaluate your work on these 4 dimensions:
1. **completeness** — Did you address ALL acceptance criteria?
2. **quality** — Does your output meet quality standards (clean code, no shortcuts)?
3. **discipline** — Did you follow the prescribed methodology (TDD, commit conventions, architecture rules)?
4. **verification** — Did you verify your own work (tests pass, linting, manual checks)?

### Output Format

Emit this block at the END of your final response:

\`\`\`
<!-- TFF_STATUS_REPORT -->
{
  "status": "DONE",
  "concerns": [],
  "selfReview": {
    "dimensions": [
      { "dimension": "completeness", "passed": true },
      { "dimension": "quality", "passed": true },
      { "dimension": "discipline", "passed": true },
      { "dimension": "verification", "passed": true }
    ],
    "overallConfidence": "high"
  }
}
<!-- /TFF_STATUS_REPORT -->
\`\`\`

### Rules

- **Never report DONE if you have unresolved concerns** — use DONE_WITH_CONCERNS instead.
- **Never silently produce work you are unsure about** — surface concerns explicitly.
- If any self-review dimension fails, explain why in the dimension's "note" field and lower overallConfidence.
- The status report MUST be in your final message, at the very end.
`.trim();

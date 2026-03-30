export const GUARDRAIL_PROMPT = `
## Safety Rules

You MUST NOT:
- Execute destructive commands (rm -rf, kill -9, chmod 777, mkfs)
- Expose credentials, API keys, or secrets in source files
- Run destructive git operations (force push, reset --hard, clean -fd)
- Modify files outside your assigned task scope
- Use eval(), new Function(), or dynamic imports
- Modify package.json or dependency files unless explicitly tasked

If your task requires any of these, report BLOCKED with explanation.
`.trim();

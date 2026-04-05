# Concerns Documentation

Generate CONCERNS.md for this codebase. Use compressor notation (∀, ∃, ∈, ∧, ∨, ¬, →, ⇒). Tables > prose. Code blocks verbatim.

## Working Directory
{{working_directory}}

{{#existing_content}}
## Existing Document
{{existing_content}}
{{/existing_content}}

{{#diff_content}}
## Changes Since Last Update
{{diff_content}}

Only update sections affected by these changes. Preserve unchanged sections.
{{/diff_content}}

## Required Sections

1. **Tech Debt** — table of location → kind → description (scan for TODO, FIXME, stub, "Not implemented")
2. **Type Safety** — `as unknown as` count (prod vs test), `as Type` count, `any` usage
3. **Test Coverage** — total source files vs spec files, coverage gaps by area
4. **Security** — .env files, hardcoded credentials, guardrail rules, auth pattern
5. **Error Handling** — Result usage count, try/catch count, throw count, consistency assessment
6. **Missing Infrastructure** — CI/CD, pre-commit hooks, coverage thresholds, dependency audit
7. **Fragile Areas** — files w/ high coupling (>10 deps), large files (>400 lines), untested adapters
8. **Recommendations** — prioritized list (ship blockers → risk reduction → hygiene)

## Instructions

1. Use `Grep` to count patterns: `TODO`, `FIXME`, `as unknown as`, `as `, `throw new Error`, `Result<`, `try {`
2. Use `Glob` to count `*.spec.ts` vs `*.ts` (excluding spec/builder/test files)
3. Identify files >400 lines via `Bash` (`wc -l`)
4. Produce markdown ≤ 40% of equivalent verbose prose
5. End with `*Last generated: {{date}}*`

## Output

Return ONLY the markdown content for CONCERNS.md. No JSON wrapper.
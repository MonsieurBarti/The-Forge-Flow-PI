# Stack Documentation

Generate STACK.md for this codebase. Use compressor notation (∀, ∃, ∈, ∧, ∨, ¬, →, ⇒). Tables > prose. Code blocks verbatim.

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

1. **Language & Runtime** — TypeScript version, Node.js version, target, module system
2. **Architecture** — hexagonal overview, hexagon table, kernel primitives, adapter strategy
3. **Framework — PI SDK** — packages, versions, tool registration
4. **Validation** — Zod version, usage
5. **Database / Persistence** — better-sqlite3, markdown adapters, YAML
6. **Testing** — Vitest, faker, coverage, contract specs
7. **Linting & Formatting** — Biome config
8. **Build** — scripts, output
9. **Key Dependencies** — full table of prod + dev deps
10. **Path Aliases** — alias → target table

## Instructions

1. Read `package.json` for deps and scripts
2. Read `tsconfig.json` for compiler config
3. Read `biome.json` for lint/format config
4. Read `vitest.config.ts` for test config
5. Produce markdown ≤ 40% of equivalent verbose prose
6. End with `*Last generated: {{date}}*`

## Output

Return ONLY the markdown content for STACK.md. No JSON wrapper.
# Conventions Documentation

Generate CONVENTIONS.md for this codebase. Use compressor notation (∀, ∃, ∈, ∧, ∨, ¬, →, ⇒). Tables > prose. Code blocks verbatim.

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

1. **File Naming** — table of pattern → example → layer
2. **Class & Type Naming** — table of kind → convention → example
3. **Import Conventions** — path aliases, ordering, rules (barrel-only cross-hexagon)
4. **Error Handling** — Result pattern, error hierarchy, thrown exceptions policy
5. **Test Structure** — placement, runner, describe/it conventions, builders, contract tests
6. **Export Patterns** — named exports, barrel structure
7. **Validation (Zod)** — version, usage patterns, schema + inferred type co-location
8. **Aggregate Design** — private constructor, createNew/reconstitute, props, events, clock
9. **Code Style** — formatter, indent, quotes, lint rules
10. **Git & Commit Conventions** — conventional commits format, scope examples

## Instructions

1. Use `Grep` to find naming patterns, import patterns, test patterns
2. Read `biome.json` and `tsconfig.json` for style/import config
3. Sample 3-4 files per pattern to confirm consistency
4. Produce markdown ≤ 40% of equivalent verbose prose
5. End with `*Last generated: {{date}}*`

## Output

Return ONLY the markdown content for CONVENTIONS.md. No JSON wrapper.
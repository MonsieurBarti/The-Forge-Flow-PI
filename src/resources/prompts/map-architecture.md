# Architecture Documentation

Generate ARCHITECTURE.md for this codebase. Use compressor notation (∀, ∃, ∈, ∧, ∨, ¬, →, ⇒). Tables > prose. Code blocks verbatim.

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

1. **Layer Model** — ASCII diagram showing CLI/PI SDK → Application → Domain → Infrastructure
2. **Path Aliases** — table of alias → path → purpose
3. **Modules (Bounded Contexts)** — table of hexagon → path → aggregate(s) → responsibility
4. **Domain Layer** — building blocks (kernel primitives), aggregate design rules, event patterns
5. **Infrastructure Layer** — adapter strategy (in-memory vs production), port/adapter pairing
6. **Cross-Cutting** — event bus, dependency injection, composition root

## Instructions

1. Use `Glob` and `Read` to scan `src/` directory structure
2. Read barrel `index.ts` files for each hexagon
3. Read kernel base classes
4. Produce markdown ≤ 40% of equivalent verbose prose
5. End with `*Last generated: {{date}}*`

## Output

Return ONLY the markdown content for ARCHITECTURE.md. No JSON wrapper.
# M01-S01: Project scaffolding, Biome & Vitest

## Bead

The-Forge-Flow-PI-4t7.1.1

## Scope

Set up the TypeScript project foundation: package.json, tsconfig, Biome linting with hexagon import boundary enforcement, Vitest with colocated test support, and the canonical directory structure.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| PI SDK | Deferred | No CLI commands yet; plain TS project until CLI milestone |
| Import boundaries | Biome `noRestrictedImports` | Single linter, covers cross-hexagon violation detection |
| Path aliases | `@kernel/*`, `@hexagons/*` | Clean imports, configured in tsconfig + vitest resolve |
| Port contract tests | Deferred to S05 | No adapters exist yet; pattern emerges with first adapter |
| Module system | ESM | Modern Node 22+ target |

## Deliverables

1. `package.json` — dependencies: typescript, zod, vitest, @biomejs/biome, @faker-js/faker, better-sqlite3 (+ types)
2. `tsconfig.json` — strict mode, ESM, path aliases (`@kernel/*` -> `src/kernel/*`, `@hexagons/*` -> `src/hexagons/*`)
3. `biome.json` — formatting, linting, `noRestrictedImports` blocking cross-hexagon internals
4. `vitest.config.ts` — colocated `*.spec.ts` pattern, path alias resolution
5. Directory structure: `src/kernel/`, `src/hexagons/`, `src/infrastructure/`, `src/cli/`
6. `.gitignore` update for node_modules, dist, coverage

## Acceptance Criteria

- [x] `biome check` passes on all source files
- [x] `vitest run` executes successfully (zero tests is OK)
- [x] Hexagon import boundary lint rules configured via `noRestrictedImports`
- [x] Path aliases resolve in both TypeScript compilation and Vitest

## Unknowns

~~1. **Biome `noRestrictedImports` glob syntax** — RESOLVED: Uses gitignore-style globs in `patterns[].group`. Enumerate each hexagon path with `*` suffix to block deep imports while allowing barrel imports. See RESEARCH.md.~~

## Complexity

**F-lite** — Multiple new config files, foundational decisions, minor investigation.

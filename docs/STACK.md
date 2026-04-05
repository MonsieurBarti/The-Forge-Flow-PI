# STACK.md -- The Forge Flow PI

Technology stack reference for `@the-forge-flow/pi` v0.1.0.

---

## Language & Runtime

| Item        | Value             | Notes                                  |
|-------------|-------------------|----------------------------------------|
| Language    | TypeScript ^5.7   | Strict mode, `verbatimModuleSyntax`    |
| Runtime     | Node.js >=22      | ESM-only (`"type": "module"`)          |
| Target      | ES2022            | Bundler module resolution              |
| Module      | ESNext            | Path aliases via `tsconfig` `paths`    |

No `.nvmrc` or `.node-version` file; engine constraint is in `package.json`.

---

## Architecture

Hexagonal (ports & adapters) + DDD + CQRS.

```
src/
  kernel/          # Shared DDD building blocks (AggregateRoot, Entity, ValueObject, Result, events)
  hexagons/        # Bounded contexts, each with domain / application / infrastructure
  infrastructure/  # Cross-cutting adapters (PI SDK bridge, git, event bus)
  cli/             # Composition root & PI extension wiring
  resources/       # Agent cards (.md), prompts, phase protocols
```

### Hexagons (bounded contexts)

| Hexagon     | Purpose                                   |
|-------------|-------------------------------------------|
| `execution` | Slice execution, checkpoints, journals, worktrees, guardrails, metrics |
| `milestone` | Milestone aggregate & lifecycle           |
| `project`   | Project initialization & settings         |
| `review`    | Code review pipeline, ship, verification, critique-reflection |
| `settings`  | User/project settings, hotkeys            |
| `slice`     | Slice aggregate & status transitions      |
| `task`      | Task aggregate, waves, status             |
| `workflow`  | Phase orchestration (discuss/research/plan/execute), context staging |

Each hexagon exposes a barrel `index.ts`; cross-hexagon deep imports are blocked by a Biome lint rule.

### Kernel primitives

`AggregateRoot`, `Entity`, `ValueObject`, `DomainEvent`, `Result<T,E>` (no exceptions for domain errors), typed event bus, Zod-based schemas.

### Adapter strategy

Every port has both an **in-memory** adapter (used in tests) and a **production** adapter (SQLite, git CLI, PI SDK, filesystem). Contract tests validate adapter interchangeability.

---

## Framework -- PI SDK

| Package                        | Version | Role                              |
|--------------------------------|---------|-----------------------------------|
| `@mariozechner/pi-ai`         | ^0.64.0 | AI provider abstraction, model types |
| `@mariozechner/pi-coding-agent`| ^0.64.0 | Agent session, extension API, tool registration |
| `@mariozechner/pi-tui`        | ^0.64.0 | Terminal UI components            |

Tools are registered via a `createZodTool` helper that converts Zod schemas to JSON Schema (draft-07) for the PI SDK tool protocol.

---

## Validation

| Library | Version | Usage                                                |
|---------|---------|------------------------------------------------------|
| Zod     | ^4.3.6  | All domain schemas, tool input validation, `toJSONSchema` for PI tools |

Zod v4 (not v3). Used pervasively across all layers -- 85+ files import it.

---

## Database / Persistence

| Technology     | Version | Usage                              |
|----------------|---------|------------------------------------|
| better-sqlite3 | ^11.0.0 | SQLite repositories (dev dependency -- stubs in domain) |

SQLite repos exist for: milestone, project, slice, task, review, ship-record, completion-record, verification. Currently stubbed (`throw new Error("Not implemented")`) -- domain logic uses in-memory adapters.

Additional persistence: markdown-based execution session adapter, YAML files for settings and agent resources.

---

## Testing

| Tool          | Version | Role                                   |
|---------------|---------|----------------------------------------|
| Vitest        | ^3.0.0  | Test runner, assertions, coverage      |
| @faker-js/faker | ^9.0.0 | Test data builders (34 builder files) |

- Test pattern: `src/**/*.spec.ts` (co-located with source)
- Coverage provider: V8
- Builder pattern: `*.builder.ts` files excluded from coverage
- Setup file: `src/test-setup.ts` (agent registry init, GIT_* env cleanup)
- Contract specs: adapter interchangeability tests (e.g., `milestone-repository.contract.spec.ts`)
- ~203 spec files, ~349 production files

---

## Linting & Formatting

| Tool   | Version | Config         |
|--------|---------|----------------|
| Biome  | ^2.4.0  | `biome.json`   |

- Formatter: spaces, indent 2, line width 100
- Linter: recommended rules + `noExplicitAny: error`
- Import enforcement: barrel-only cross-hexagon imports (via `noRestrictedImports`)
- Auto-organize imports on save

---

## Build

| Script      | Command         | Purpose             |
|-------------|-----------------|----------------------|
| `build`     | `tsc`           | TypeScript compile   |
| `typecheck` | `tsc --noEmit`  | Type checking only   |
| `lint`      | `biome check .` | Lint + format check  |
| `test`      | `vitest run`    | Run all tests        |

Output: `dist/` directory with declarations, declaration maps, and source maps.

No bundler (esbuild/webpack/rollup). No Docker. No CI workflow files in-repo.

---

## Key Dependencies (full table)

| Package                          | Version | Type | Purpose                           |
|----------------------------------|---------|------|-----------------------------------|
| `@mariozechner/pi-ai`           | ^0.64.0 | prod | AI provider types & API           |
| `@mariozechner/pi-coding-agent` | ^0.64.0 | prod | Agent session & extension API     |
| `@mariozechner/pi-tui`          | ^0.64.0 | prod | Terminal UI                       |
| `yaml`                          | ^2.8.3  | prod | YAML parse/stringify for settings & agent templates |
| `zod`                           | ^4.3.6  | prod | Schema validation everywhere      |
| `@biomejs/biome`                | ^2.4.0  | dev  | Lint + format                     |
| `@faker-js/faker`               | ^9.0.0  | dev  | Test data generation              |
| `@types/better-sqlite3`         | ^7.6.0  | dev  | SQLite type definitions           |
| `@types/node`                   | ^22.0.0 | dev  | Node.js type definitions          |
| `better-sqlite3`                | ^11.0.0 | dev  | SQLite driver                     |
| `typescript`                    | ^5.7.0  | dev  | Compiler                          |
| `vitest`                        | ^3.0.0  | dev  | Test framework                    |

---

## Path Aliases

| Alias               | Target                  |
|----------------------|-------------------------|
| `@kernel`            | `src/kernel`            |
| `@kernel/*`          | `src/kernel/*`          |
| `@hexagons/*`        | `src/hexagons/*`        |
| `@infrastructure/*`  | `src/infrastructure/*`  |
| `@resources`         | `src/resources`         |
| `@resources/*`       | `src/resources/*`       |

Aliases are duplicated in `tsconfig.json` (compilation) and `vitest.config.ts` (test resolution).

---

*Last generated: 2026-04-04*

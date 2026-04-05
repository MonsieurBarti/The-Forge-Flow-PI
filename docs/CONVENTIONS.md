# CONVENTIONS.md -- The Forge Flow PI

Naming, import, error-handling, test, and code-style conventions observed in this codebase.

---

## File Naming

| Pattern | Example | Layer |
|---------|---------|-------|
| `{name}.aggregate.ts` | `slice.aggregate.ts` | Domain |
| `{name}.vo.ts` | `slice-status.vo.ts` | Domain |
| `{name}.schemas.ts` | `slice.schemas.ts` | Domain |
| `{name}.builder.ts` | `slice.builder.ts` | Domain (test) |
| `{name}.base.ts` | `entity.base.ts` | Kernel |
| `{name}.event.ts` | `slice-created.event.ts` | Domain (`events/`) |
| `{name}.error.ts` | `slice-not-found.error.ts` | Domain (`errors/`) |
| `{name}-repository.port.ts` | `slice-repository.port.ts` | Domain (`ports/`) |
| `{name}.port.ts` | `git.port.ts` | Kernel (`ports/`) |
| `{verb}-{noun}.use-case.ts` | `start-discuss.use-case.ts` | Application / Use Cases |
| `in-memory-{name}.repository.ts` | `in-memory-slice.repository.ts` | Infrastructure |
| `sqlite-{name}.repository.ts` | `sqlite-slice.repository.ts` | Infrastructure |
| `{name}.tool.ts` | `workflow-transition.tool.ts` | Infrastructure (`pi/`) |
| `{name}.extension.ts` | `overlay.extension.ts` | CLI / Infrastructure |
| `{name}.contract.spec.ts` | `slice-repository.contract.spec.ts` | Infrastructure (test) |
| `{name}.spec.ts` | `slice.aggregate.spec.ts` | Co-located with source |
| `index.ts` | `index.ts` | Barrel (hexagon root, kernel, subdirs) |

All files use **kebab-case**. No `PascalCase` or `camelCase` filenames.

---

## Class & Type Naming

| Kind | Convention | Example |
|------|-----------|---------|
| Aggregate | `PascalCase` noun | `Slice`, `WorkflowSession` |
| Value Object | `PascalCase` + `VO` suffix | `SliceStatusVO` |
| Domain Event | `{Entity}{Action}Event` | `SliceCreatedEvent`, `ExecutionPausedEvent` |
| Error | `{Context}{Problem}Error` | `SliceNotFoundError`, `GuardRejectedError` |
| Port | `{Name}Port` (abstract class) | `GitPort`, `SliceRepositoryPort` |
| Use Case | `{Verb}{Noun}UseCase` | `StartDiscussUseCase`, `ShipSliceUseCase` |
| Adapter (in-memory) | `InMemory{Name}` | `InMemorySliceRepository` |
| Adapter (sqlite) | `Sqlite{Name}` | `SqliteSliceRepository` |
| Adapter (infra) | `{Tech}{Name}` | `GitCliAdapter`, `PiAgentDispatcher` |
| Builder | `{Entity}Builder` | `SliceBuilder` |
| Schema (Zod) | `{Name}Schema` | `SlicePropsSchema`, `ComplexityCriteriaSchema` |
| Inferred type | `type X = z.infer<typeof XSchema>` | `type SliceProps = z.infer<typeof SlicePropsSchema>` |

---

## Import Conventions

**Path aliases** (from `tsconfig.json`):

| Alias | Target | Usage |
|-------|--------|-------|
| `@kernel` | `src/kernel/` | Barrel import for kernel types/classes |
| `@kernel/*` | `src/kernel/*` | Sub-module imports (agents, errors, ports, infra) |
| `@hexagons/*` | `src/hexagons/*/` | Barrel-only cross-hexagon imports |
| `@infrastructure/*` | `src/infrastructure/*/` | Shared PI SDK helpers |
| `@resources` / `@resources/*` | `src/resources/` | Agent cards, prompts |

**Import ordering** (enforced by Biome `organizeImports`):
1. External packages (`zod`, `vitest`, `@faker-js/faker`)
2. Path-aliased imports (`@kernel`, `@hexagons/*`, `@infrastructure/*`)
3. Relative imports (`../domain/...`, `./...`)

**Rules**:
- Cross-hexagon imports must go through barrel (`@hexagons/slice`), never deep (`@hexagons/slice/domain/...`). Enforced by `noRestrictedImports` lint rule.
- Override: spec files (`*.spec.ts`) and `src/cli/` are exempt from the barrel restriction.
- `import type` used for type-only imports (`verbatimModuleSyntax` enforced).
- Zero `export default` usage -- all exports are named.

---

## Error Handling

**Result pattern** -- no thrown exceptions for expected domain failures:

```
Result<T, E> = { ok: true; data: T } | { ok: false; error: E }
```

Helpers: `ok(data)`, `err(error)`, `isOk(r)`, `isErr(r)`, `match(r, { ok, err })`.

**Error hierarchy**:

| Class | Code Pattern | Location |
|-------|-------------|----------|
| `BaseDomainError` (abstract) | -- | `kernel/errors/` |
| `PersistenceError` | `PERSISTENCE.FAILURE` | `kernel/errors/` |
| `InvalidTransitionError` | `DOMAIN.INVALID_TRANSITION` | `kernel/errors/` |
| `GitError` | `GIT.*` | `kernel/errors/` |
| `GitHubError` | `GITHUB.*` | `kernel/errors/` |
| `SyncError` | `SYNC.*` | `kernel/errors/` |
| `WorkflowBaseError` (abstract) | -- | Per-hexagon base |
| `{Context}{Problem}Error` | `{HEXAGON}.{CODE}` | Per-hexagon `domain/errors/` |

All domain errors extend `BaseDomainError`, carry a `code` string, and optional `metadata` record. Hexagons may define an intermediate base (e.g. `WorkflowBaseError`) for grouping.

**Thrown exceptions** are reserved for programmer errors (Zod validation failures at construction time).

---

## Test Structure

- **Placement**: co-located as `*.spec.ts` alongside source.
- **Runner**: Vitest. Imports: `import { describe, expect, it, beforeEach } from "vitest"`.
- **Setup file**: `src/test-setup.ts` -- strips `GIT_*` env vars, initializes agent registry.
- **Coverage**: V8 provider. Builders (`*.builder.ts`) excluded.

**describe/it conventions**:
```
describe("Slice", () => {
  describe("createNew", () => {
    it("creates a valid slice with status discussing", () => { ... });
  });
  describe("transitionTo", () => {
    it("transitions discussing -> researching", () => { ... });
    it("rejects invalid transition", () => { ... });
  });
});
```

Top-level `describe` = class or module name. Nested `describe` = method or behavior group. `it` descriptions are lowercase imperative.

**Builders**: fluent `with*()` methods, `build()` returns aggregate, `buildProps()` returns raw props. Uses `@faker-js/faker` for defaults.

**Contract tests**: function `runContractTests(name, factory)` validates adapter interchangeability against the port contract (e.g. `slice-repository.contract.spec.ts`).

---

## Export Patterns

- All exports are **named** (zero `export default`).
- Each hexagon has a root `index.ts` barrel exporting its public API (ports, events, errors, schemas, key adapters).
- Internal modules (domain, infrastructure subdirs) may have their own `index.ts` barrels.
- Kernel `index.ts` re-exports all building blocks, errors, ports, schemas, and infrastructure adapters.
- Types exported via `export type` when they are type-only.

---

## Validation (Zod)

- Zod v4 (not v3) used across all layers.
- Every entity, aggregate, value object, and domain event validates props at construction via `schema.parse(props)`.
- Schema + inferred type always co-located: `export const FooSchema = z.object({...})` followed by `export type Foo = z.infer<typeof FooSchema>`.
- PI tool input schemas use `z.object()` + `createZodTool()` to convert to JSON Schema for the PI SDK.
- Enums via `z.enum([...])` (not `z.nativeEnum`).

---

## Aggregate Design

- Private constructor; static factory `createNew(params)` for creation, `reconstitute(props)` for hydration.
- `createNew` emits domain events; `reconstitute` does not.
- Props exposed via explicit getters (no public `props` access).
- `toJSON()` returns a shallow copy of props.
- Events collected via `addEvent()`, drained via `pullEvents()`.
- Clock (`now: Date`) passed as parameter, never called internally.

---

## Code Style

| Setting | Value |
|---------|-------|
| Formatter | Biome |
| Indent | 2 spaces |
| Line width | 100 |
| Semicolons | Always (Biome default) |
| Quotes | Double (Biome default) |
| `noExplicitAny` | Error |
| TypeScript strict | Yes |
| `verbatimModuleSyntax` | Yes |

---

## Git & Commit Conventions

Format: **conventional commits**.

```
type(scope): description
```

| Type | Usage |
|------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructure without behavior change |
| `chore` | Tooling, config, maintenance |

Scope examples: `M05`, `S08/T06`, hexagon name. Squash-merge PRs use milestone label as title (e.g. `M06: PI-Native Integration (#46)`).

---

*Last generated: 2026-04-04*

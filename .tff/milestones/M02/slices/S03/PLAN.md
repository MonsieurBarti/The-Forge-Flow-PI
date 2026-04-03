# M02-S03: Settings Hexagon — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Configuration system with 4-layer cascade (defaults < team YAML < local YAML < env vars), resilient per-field defaults via Zod `.catch()`, and model resolution with budget enforcement + fallback chains.

**Architecture:** Standalone `ProjectSettings` class (not ValueObject/AggregateRoot), Zod schemas with `.default()` + `.catch()`, three use cases behind ports.

**Tech Stack:** Zod 4.3.6, yaml ^2.8.3 (new dep), Vitest, TypeScript

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Modify | Add `yaml` dependency |
| `src/kernel/schemas.ts` | Modify | Move ComplexityTierSchema to kernel (shared with slice hexagon) |
| `src/hexagons/settings/domain/project-settings.schemas.ts` | Create | All Zod schemas, enums, defaults constants, types |
| `src/hexagons/settings/domain/project-settings.schemas.spec.ts` | Create | Schema validation + resilience tests |
| `src/hexagons/settings/domain/errors/settings-file.error.ts` | Create | SettingsFileError domain error |
| `src/hexagons/settings/domain/ports/settings-file.port.ts` | Create | Abstract file reading port |
| `src/hexagons/settings/domain/ports/budget-tracking.port.ts` | Create | Abstract budget tracking port |
| `src/hexagons/settings/domain/ports/env-var.port.ts` | Create | Abstract env var port |
| `src/hexagons/settings/domain/project-settings.value-object.ts` | Create | ProjectSettings class with create/reconstitute |
| `src/hexagons/settings/domain/project-settings.value-object.spec.ts` | Create | Value object tests |
| `src/hexagons/settings/domain/project-settings.builder.ts` | Create | Test builder with fluent chaining |
| `src/hexagons/settings/infrastructure/in-memory-settings-file.adapter.ts` | Create | Map-based SettingsFilePort for testing |
| `src/hexagons/settings/infrastructure/in-memory-env-var.adapter.ts` | Create | Map-based EnvVarPort for testing |
| `src/hexagons/settings/infrastructure/always-under-budget.adapter.ts` | Create | Stub BudgetTrackingPort (always 0%) |
| `src/hexagons/settings/infrastructure/fs-settings-file.adapter.ts` | Create | Node fs SettingsFilePort |
| `src/hexagons/settings/infrastructure/process-env-var.adapter.ts` | Create | process.env EnvVarPort |
| `src/hexagons/settings/infrastructure/settings-file.contract.spec.ts` | Create | Contract tests for SettingsFilePort |
| `src/hexagons/settings/use-cases/load-settings.use-case.ts` | Create | YAML loading, key normalization, structural reshape |
| `src/hexagons/settings/use-cases/load-settings.use-case.spec.ts` | Create | Load use case tests |
| `src/hexagons/settings/use-cases/merge-settings.use-case.ts` | Create | Deep-merge + schema validation |
| `src/hexagons/settings/use-cases/merge-settings.use-case.spec.ts` | Create | Merge use case tests |
| `src/hexagons/settings/use-cases/resolve-model.use-case.ts` | Create | Model resolution with budget + fallback |
| `src/hexagons/settings/use-cases/resolve-model.use-case.spec.ts` | Create | Resolve use case tests |
| `src/hexagons/settings/index.ts` | Create | Barrel exports |

---

## Wave 0 (parallel — no dependencies)

### T01: Settings schemas + default constants + tests
**Files:** Create `src/hexagons/settings/domain/project-settings.schemas.ts`, Create `src/hexagons/settings/domain/project-settings.schemas.spec.ts`
**Traces to:** AC1, AC2

- [ ] Step 1: Write failing tests in `project-settings.schemas.spec.ts`:
  - `SettingsSchema.parse({})` produces fully-hydrated defaults (AC2)
  - `SettingsSchema.parse({ autonomy: 123 })` recovers autonomy via `.catch()`, modelRouting unaffected (AC1)
  - `ModelProfileNameSchema.parse("quality")` succeeds
  - `ModelProfileNameSchema.parse("invalid")` throws
  - `ComplexityTierSchema.parse("F-lite")` succeeds
  - `ModelNameSchema.parse("opus")` succeeds
  - Default complexity mapping: S→budget, F-lite→balanced, F-full→quality
- [ ] Step 2: Run `npx vitest run src/hexagons/settings/domain/project-settings.schemas.spec.ts`, verify FAIL
- [ ] Step 3: Implement `project-settings.schemas.ts`:
  - Move `ComplexityTierSchema` from `src/hexagons/slice/domain/slice.schemas.ts` to `src/kernel/schemas.ts` (shared kernel — used by both slice and settings hexagons). Update slice hexagon to re-export from kernel.
  - `ModelNameSchema` = `z.enum(["opus", "sonnet", "haiku"])`
  - `ModelProfileNameSchema` = `z.enum(["quality", "balanced", "budget"])`
  - Import `ComplexityTierSchema` from `@kernel` (already moved above)
  - `AutonomyModeSchema` = `z.enum(["guided", "plan-to-pr"])`
  - `ModelProfileSchema` = `z.object({ model: ModelNameSchema.default("sonnet"), fallbackChain: z.array(ModelNameSchema).default([]) })`
  - `BudgetConfigSchema` = `z.object({ limit: z.number().optional(), thresholds: z.tuple([z.number(), z.number()]).default([50, 75]) })`
  - `ModelRoutingConfigSchema` with `.catch(MODEL_ROUTING_DEFAULTS)`
  - `AutonomyConfigSchema` with `.catch(AUTONOMY_DEFAULTS)`
  - `AutoLearnConfigSchema` with `.catch(AUTO_LEARN_DEFAULTS)`
  - `BeadsConfigSchema` with `.catch(BEADS_DEFAULTS)`
  - `SettingsSchema` = `z.object({...}).default(SETTINGS_DEFAULTS)`
  - Export all `*_DEFAULTS` constants, all schemas, all inferred types
  - `RawSettingsSources` type
  - `ENV_VAR_MAP` constant (hardcoded mapping table)
- [ ] Step 4: Run `npx vitest run src/hexagons/settings/domain/project-settings.schemas.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/settings/domain/project-settings.schemas.ts src/hexagons/settings/domain/project-settings.schemas.spec.ts && git commit -m "feat(S03/T01): add settings schemas with resilient defaults"`

### T02: SettingsFileError + all ports
**Files:** Create `src/hexagons/settings/domain/errors/settings-file.error.ts`, Create `src/hexagons/settings/domain/ports/settings-file.port.ts`, Create `src/hexagons/settings/domain/ports/budget-tracking.port.ts`, Create `src/hexagons/settings/domain/ports/env-var.port.ts`
**Traces to:** (infrastructure — enables AC3, AC5, AC6, AC8, AC10)

- [ ] Step 1: Create `settings-file.error.ts`:
  ```typescript
  import { BaseDomainError } from "@kernel";

  export class SettingsFileError extends BaseDomainError {
    readonly code = "SETTINGS.FILE_READ_ERROR";

    constructor(path: string, cause?: Error) {
      super(`Failed to read settings file: ${path}`, { path, cause: cause?.message });
    }
  }
  ```
- [ ] Step 2: Create `settings-file.port.ts`:
  ```typescript
  import type { Result } from "@kernel";
  import type { SettingsFileError } from "../errors/settings-file.error";

  export abstract class SettingsFilePort {
    abstract readFile(path: string): Promise<Result<string | null, SettingsFileError>>;
  }
  ```
- [ ] Step 3: Create `budget-tracking.port.ts`:
  ```typescript
  import type { Result } from "@kernel";

  export abstract class BudgetTrackingPort {
    abstract getUsagePercent(): Promise<Result<number, never>>;
  }
  ```
- [ ] Step 4: Create `env-var.port.ts`:
  ```typescript
  export abstract class EnvVarPort {
    abstract get(key: string): string | undefined;
  }
  ```
- [ ] Step 5: Run `npx vitest run --typecheck` to confirm no type errors
- [ ] Step 6: `git add src/hexagons/settings/domain/errors/ src/hexagons/settings/domain/ports/ && git commit -m "feat(S03/T02): add SettingsFileError and ports"`

---

## Wave 1 (depends on Wave 0)

### T03: ProjectSettings value object + tests
**Files:** Create `src/hexagons/settings/domain/project-settings.value-object.ts`, Create `src/hexagons/settings/domain/project-settings.value-object.spec.ts`
**Depends on:** T01
**Traces to:** AC1, AC2

- [ ] Step 1: Write failing tests in `project-settings.value-object.spec.ts`:
  - `ProjectSettings.create({})` returns instance with all defaults
  - `ProjectSettings.create({})` → `modelRouting.profiles.quality.model` === `"opus"`
  - `ProjectSettings.create({ autonomy: "garbage" })` → autonomy falls back to defaults, modelRouting unaffected
  - `ProjectSettings.reconstitute(validProps)` returns instance without re-validation
  - Getters: `.modelRouting`, `.autonomy`, `.autoLearn`, `.beads` return correct sections
  - `.toJSON()` returns full props snapshot
- [ ] Step 2: Run `npx vitest run src/hexagons/settings/domain/project-settings.value-object.spec.ts`, verify FAIL
- [ ] Step 3: Implement `project-settings.value-object.ts`:
  ```typescript
  import type { SettingsProps } from "./project-settings.schemas";
  import { SettingsSchema } from "./project-settings.schemas";

  export class ProjectSettings {
    private constructor(private readonly props: SettingsProps) {}

    static create(raw: unknown): ProjectSettings {
      const validated = SettingsSchema.parse(raw);
      return new ProjectSettings(validated);
    }

    static reconstitute(props: SettingsProps): ProjectSettings {
      return new ProjectSettings(props);
    }

    get modelRouting() { return this.props.modelRouting; }
    get autonomy() { return this.props.autonomy; }
    get autoLearn() { return this.props.autoLearn; }
    get beads() { return this.props.beads; }

    toJSON(): SettingsProps { return { ...this.props }; }
  }
  ```
- [ ] Step 4: Run `npx vitest run src/hexagons/settings/domain/project-settings.value-object.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/settings/domain/project-settings.value-object.ts src/hexagons/settings/domain/project-settings.value-object.spec.ts && git commit -m "feat(S03/T03): add ProjectSettings value object"`

### T04: In-memory + stub adapters
**Files:** Create `src/hexagons/settings/infrastructure/in-memory-settings-file.adapter.ts`, Create `src/hexagons/settings/infrastructure/in-memory-env-var.adapter.ts`, Create `src/hexagons/settings/infrastructure/always-under-budget.adapter.ts`
**Depends on:** T02
**Traces to:** (testing infrastructure for AC3, AC8, AC10)

- [ ] Step 1: Create `in-memory-settings-file.adapter.ts`:
  ```typescript
  import { ok, type Result } from "@kernel";
  import type { SettingsFileError } from "../domain/errors/settings-file.error";
  import { SettingsFilePort } from "../domain/ports/settings-file.port";

  export class InMemorySettingsFileAdapter extends SettingsFilePort {
    private store = new Map<string, string>();

    async readFile(path: string): Promise<Result<string | null, SettingsFileError>> {
      return ok(this.store.get(path) ?? null);
    }

    seed(path: string, content: string): void { this.store.set(path, content); }
    reset(): void { this.store.clear(); }
  }
  ```
- [ ] Step 2: Create `in-memory-env-var.adapter.ts`:
  ```typescript
  import { EnvVarPort } from "../domain/ports/env-var.port";

  export class InMemoryEnvVarAdapter extends EnvVarPort {
    private store = new Map<string, string>();

    get(key: string): string | undefined { return this.store.get(key); }

    seed(key: string, value: string): void { this.store.set(key, value); }
    reset(): void { this.store.clear(); }
  }
  ```
- [ ] Step 3: Create `always-under-budget.adapter.ts`:
  ```typescript
  import { ok, type Result } from "@kernel";
  import { BudgetTrackingPort } from "../domain/ports/budget-tracking.port";

  export class AlwaysUnderBudgetAdapter extends BudgetTrackingPort {
    async getUsagePercent(): Promise<Result<number, never>> { return ok(0); }
  }
  ```
- [ ] Step 4: Run `npx vitest run --typecheck` to confirm no type errors
- [ ] Step 5: `git add src/hexagons/settings/infrastructure/ && git commit -m "feat(S03/T04): add in-memory and stub adapters"`

### T05: ProjectSettings builder
**Files:** Create `src/hexagons/settings/domain/project-settings.builder.ts`
**Depends on:** T01, T03
**Traces to:** (testing infrastructure)

- [ ] Step 1: Create `project-settings.builder.ts` with fluent chaining:
  - Default values from `SETTINGS_DEFAULTS`
  - `.withModelRouting(config)`, `.withAutonomy(config)`, `.withAutoLearn(config)`, `.withBeads(config)` methods
  - `.withAutonomyMode(mode)` shorthand
  - `.withComplexityMapping(mapping)` shorthand
  - `.build()` → `ProjectSettings.create(props)`
  - `.buildProps()` → raw props
- [ ] Step 2: Run `npx vitest run --typecheck` to confirm no type errors
- [ ] Step 3: `git add src/hexagons/settings/domain/project-settings.builder.ts && git commit -m "feat(S03/T05): add ProjectSettings builder"`

---

## Wave 2 (depends on Wave 1)

### T06: Fs + Process adapters + contract tests
**Files:** Create `src/hexagons/settings/infrastructure/fs-settings-file.adapter.ts`, Create `src/hexagons/settings/infrastructure/process-env-var.adapter.ts`, Create `src/hexagons/settings/infrastructure/settings-file.contract.spec.ts`
**Depends on:** T02, T04
**Traces to:** AC8

- [ ] Step 1: Write contract tests in `settings-file.contract.spec.ts`:
  - `readFile(existingPath)` returns `ok(content)`
  - `readFile(nonExistentPath)` returns `ok(null)` (not an error)
  - Run against both InMemorySettingsFileAdapter and FsSettingsFileAdapter
- [ ] Step 2: Run `npx vitest run src/hexagons/settings/infrastructure/settings-file.contract.spec.ts`, verify FAIL
- [ ] Step 3: Implement `fs-settings-file.adapter.ts`:
  ```typescript
  import { readFile } from "node:fs/promises";
  import { err, ok, type Result } from "@kernel";
  import { SettingsFileError } from "../domain/errors/settings-file.error";
  import { SettingsFilePort } from "../domain/ports/settings-file.port";

  export class FsSettingsFileAdapter extends SettingsFilePort {
    async readFile(path: string): Promise<Result<string | null, SettingsFileError>> {
      try {
        const content = await readFile(path, "utf-8");
        return ok(content);
      } catch (e: unknown) {
        if (e instanceof Error && "code" in e && e.code === "ENOENT") return ok(null);
        return err(new SettingsFileError(path, e instanceof Error ? e : undefined));
      }
    }
  }
  ```
- [ ] Step 4: Implement `process-env-var.adapter.ts`:
  ```typescript
  import { EnvVarPort } from "../domain/ports/env-var.port";

  export class ProcessEnvVarAdapter extends EnvVarPort {
    get(key: string): string | undefined { return process.env[key]; }
  }
  ```
- [ ] Step 5: Run `npx vitest run src/hexagons/settings/infrastructure/settings-file.contract.spec.ts`, verify PASS
- [ ] Step 6: `git add src/hexagons/settings/infrastructure/ && git commit -m "feat(S03/T06): add fs and process adapters with contract tests"`

### T07: LoadSettingsUseCase + tests
**Files:** Modify `package.json` (add yaml), Create `src/hexagons/settings/use-cases/load-settings.use-case.ts`, Create `src/hexagons/settings/use-cases/load-settings.use-case.spec.ts`
**Depends on:** T01, T02, T04
**Traces to:** AC8, AC9, AC10

- [ ] Step 1: Add `yaml` dependency: `npm install yaml`
- [ ] Step 2: Write failing tests in `load-settings.use-case.spec.ts`:
  - Given team YAML with kebab-case keys → result has camelCase keys (AC9)
  - Given team YAML with `model-profiles` → result has `modelRouting.profiles` (structural reshape)
  - Given missing file → source returns `null`, no error (AC8)
  - Given syntactically invalid YAML → source returns `null` (AC8)
  - Given `TFF_AUTONOMY_MODE=guided` env var → env source has `{ autonomy: { mode: "guided" } }` (AC10)
  - Given `TFF_MODEL_QUALITY=haiku` → env source has `{ modelRouting: { profiles: { quality: { model: "haiku" } } } }` (AC10)
  - Given both team and local files → both sources populated
- [ ] Step 3: Run `npx vitest run src/hexagons/settings/use-cases/load-settings.use-case.spec.ts`, verify FAIL
- [ ] Step 4: Implement `load-settings.use-case.ts`:
  - `kebabToCamelCase(str)` + recursive `normalizeKeys(obj)` helpers
  - `reshapeToSchema(normalized)` — moves `modelProfiles` → `modelRouting.profiles`
  - `buildEnvObject(envPort)` — reads each key from `ENV_VAR_MAP`, builds nested object. **Numeric env vars** (`TFF_AUTONOMY_MAX_RETRIES`, `TFF_BEADS_TIMEOUT`) must be parsed via `Number(value)` before placement — raw strings would be caught by `.catch()` and silently swallowed.
  - `execute(projectRoot)`:
    1. Read team/local YAML via `SettingsFilePort`
    2. Parse YAML (try-catch, null on failure)
    3. Normalize keys + reshape
    4. Build env object
    5. Return `RawSettingsSources`
- [ ] Step 5: Run `npx vitest run src/hexagons/settings/use-cases/load-settings.use-case.spec.ts`, verify PASS
- [ ] Step 6: `git add package.json package-lock.json src/hexagons/settings/use-cases/load-settings.use-case.ts src/hexagons/settings/use-cases/load-settings.use-case.spec.ts && git commit -m "feat(S03/T07): add LoadSettingsUseCase with kebab normalization"`

### T08: MergeSettingsUseCase + tests
**Files:** Create `src/hexagons/settings/use-cases/merge-settings.use-case.ts`, Create `src/hexagons/settings/use-cases/merge-settings.use-case.spec.ts`
**Depends on:** T01, T03
**Traces to:** AC1, AC2, AC3

- [ ] Step 1: Write failing tests in `merge-settings.use-case.spec.ts`:
  - Given all null sources → returns defaults (AC2)
  - Given team overrides autonomy.mode → merged result has team's value (AC3 layer 2)
  - Given team + local both set autonomy.mode → local wins (AC3 layer 3)
  - Given env overrides autonomy.mode → env wins over team and local (AC3 layer 4)
  - Given corrupted team section (autonomy: 123) → falls back to defaults for autonomy, modelRouting unaffected (AC1)
  - Arrays are replaced: team has `fallbackChain: ["sonnet"]`, local has `fallbackChain: ["haiku"]` → result has `["haiku"]`
  - Result is always a valid `ProjectSettings` (never errors)
- [ ] Step 2: Run `npx vitest run src/hexagons/settings/use-cases/merge-settings.use-case.spec.ts`, verify FAIL
- [ ] Step 3: Implement `merge-settings.use-case.ts`:
  - `isPlainObject(value)` type guard
  - `deepMerge(target, source)` — recursive, arrays replaced
  - `execute(sources: RawSettingsSources)`:
    1. Start with `{}`
    2. Deep-merge team (if not null)
    3. Deep-merge local (if not null)
    4. Deep-merge env
    5. `ProjectSettings.create(merged)` — schema validates + applies defaults/catches
    6. Return `ok(settings)`
- [ ] Step 4: Run `npx vitest run src/hexagons/settings/use-cases/merge-settings.use-case.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/settings/use-cases/merge-settings.use-case.ts src/hexagons/settings/use-cases/merge-settings.use-case.spec.ts && git commit -m "feat(S03/T08): add MergeSettingsUseCase with 4-layer cascade"`

### T09: ResolveModelUseCase + tests
**Files:** Create `src/hexagons/settings/use-cases/resolve-model.use-case.ts`, Create `src/hexagons/settings/use-cases/resolve-model.use-case.spec.ts`
**Depends on:** T01, T02, T03, T04
**Traces to:** AC4, AC5, AC6, AC7

- [ ] Step 1: Write failing tests in `resolve-model.use-case.spec.ts`:
  - Default settings + S complexity → `"sonnet"` (budget profile → sonnet model) (AC4)
  - Default settings + F-lite → `"sonnet"` (balanced profile → sonnet model) (AC4)
  - Default settings + F-full → `"opus"` (quality profile → opus model) (AC4)
  - Budget at 50% + F-full → downshift to balanced → `"sonnet"` (AC5)
  - Budget at 75% + F-full → downshift to budget → `"sonnet"` (AC5)
  - Budget at 75% + S (already budget) → no further downshift → `"sonnet"` (AC5)
  - Resolved model in `unavailableModels` → walks fallbackChain (AC6)
  - Entire fallbackChain exhausted → returns last model in chain (AC6)
  - Phase override `{ review: "budget" }` + F-full + phase "review" → budget profile (AC7)
  - Phase override does not affect other phases (AC7)
- [ ] Step 2: Run `npx vitest run src/hexagons/settings/use-cases/resolve-model.use-case.spec.ts`, verify FAIL
- [ ] Step 3: Implement `resolve-model.use-case.ts`:
  - Profile priority order: `["quality", "balanced", "budget"]` (for downshift comparison)
  - `execute(params)`:
    1. Determine profile name: `phaseOverrides[phase] ?? complexityMapping[complexity]`
    2. Get budget percent via `BudgetTrackingPort`
    3. Apply downshift: `>= 75%` → budget, `>= 50%` → balanced (only if current profile is higher)
    4. Look up `profiles[profileName].model`
    5. If model in `unavailableModels`, walk `fallbackChain`
    6. Return `ok(modelName)`
- [ ] Step 4: Run `npx vitest run src/hexagons/settings/use-cases/resolve-model.use-case.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/settings/use-cases/resolve-model.use-case.ts src/hexagons/settings/use-cases/resolve-model.use-case.spec.ts && git commit -m "feat(S03/T09): add ResolveModelUseCase with budget and fallback"`

---

## Wave 3 (depends on all)

### T10: Barrel exports + final verification
**Files:** Create `src/hexagons/settings/index.ts`
**Depends on:** T01–T09
**Traces to:** all ACs

- [ ] Step 1: Create `index.ts` with public API exports:
  - Value Object: `ProjectSettings`
  - Errors: `SettingsFileError`
  - Ports: `SettingsFilePort`, `BudgetTrackingPort`, `EnvVarPort`
  - Use Cases: `LoadSettingsUseCase`, `MergeSettingsUseCase`, `ResolveModelUseCase`
  - Schemas: `SettingsSchema`, `ModelNameSchema`, `ModelProfileNameSchema`, `AutonomyModeSchema`
  - Types: `SettingsProps`, `ModelName`, `ModelProfileName`, `AutonomyMode`, `ModelRoutingConfig`, `AutonomyConfig`, `RawSettingsSources`
  - Defaults: `SETTINGS_DEFAULTS`, `MODEL_ROUTING_DEFAULTS`, `AUTONOMY_DEFAULTS`
  - Note: `ComplexityTierSchema` / `ComplexityTier` re-exported from `@kernel`, not from settings barrel
- [ ] Step 2: Run full test suite: `npx vitest run src/hexagons/settings/`
- [ ] Step 3: Run lint: `npx biome check src/hexagons/settings/`
- [ ] Step 4: Run typecheck: `npx tsc --noEmit`
- [ ] Step 5: `git add src/hexagons/settings/index.ts && git commit -m "feat(S03/T10): add barrel exports and verify settings hexagon"`

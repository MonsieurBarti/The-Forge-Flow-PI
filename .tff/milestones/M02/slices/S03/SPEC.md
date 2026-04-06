# M02-S03: Settings Hexagon

## Problem

TFF needs a configuration system that loads project settings from multiple sources (defaults, team YAML, local YAML, environment variables), merges them with clear precedence, and resolves which AI model to use based on workflow phase, complexity tier, and budget constraints. The system must be resilient: corrupted or partial config files must never crash the system — each field falls back to sensible defaults independently.

## Approach

**Schema-First Cascade**: merge raw config objects from all sources in priority order, then validate the merged result through a Zod schema where every field has `.default()` and every sub-schema has `.catch()`. This means:
- The schema is the single source of truth for defaults
- Corruption in one section (e.g., `autonomy`) is isolated — it doesn't poison siblings (e.g., `modelRouting`)
- The merge is a simple deep-merge of plain objects, decoupled from validation

`ProjectSettings` is a **Value Object** (not an AggregateRoot) — settings are read-only from the domain perspective. No domain events, no mutation methods. Use cases return new instances.

Budget tracking is abstracted behind a `BudgetTrackingPort` with an `AlwaysUnderBudgetAdapter` stub for now. Real budget tracking will be added when token consumption data is available.

## Design

### Schemas

```
SettingsSchema
├── modelRouting: ModelRoutingConfigSchema
│   ├── profiles: Record<ModelProfileName, ModelProfileSchema>
│   │   └── ModelProfileSchema: { model: ModelName, fallbackChain?: ModelName[] }
│   ├── phaseOverrides?: Record<string, ModelProfileName>
│   ├── complexityMapping: Record<ComplexityTier, ModelProfileName>
│   └── budget?: BudgetConfigSchema { limit?: number, thresholds: [50, 75] }
├── autonomy: AutonomyConfigSchema
│   ├── mode: "guided" | "plan-to-pr"
│   └── maxRetries: number (default: 2)
├── autoLearn: AutoLearnConfigSchema
│   ├── weights: { frequency, breadth, recency, consistency }
│   ├── guardrails: { minCorrections, cooldownDays, maxDriftPct }
│   └── clustering: { minSessions, minPatterns, jaccardThreshold }
└── beads: BeadsConfigSchema
    └── timeout: number (default: 30000)
```

- `ModelProfileName` = `z.enum(["quality", "balanced", "budget"])`
- `ComplexityTier` = `z.enum(["S", "F-lite", "F-full"])`
- `ModelName` = `z.enum(["opus", "sonnet", "haiku"])`
- Every leaf field has `.default()` so `{}` produces valid settings
- Every sub-schema wrapped with `.catch()` for corruption isolation
- **Zod `.default()` caveat**: In Zod 4, a parent `.default({})` provides `{}` literally — it does NOT cascade through inner schemas. Therefore, each sub-schema's `.default()` must provide the **fully-hydrated default object** (not `{}`). Example: `ModelRoutingConfigSchema.default({ profiles: { quality: { model: 'opus' }, balanced: { model: 'sonnet' }, budget: { model: 'sonnet' } }, complexityMapping: { S: 'budget', 'F-lite': 'balanced', 'F-full': 'quality' } })`. The `.catch()` per sub-schema also must provide the fully-hydrated fallback.
- **Key normalization**: YAML uses kebab-case (`model-profiles`, `max-retries`), schemas use camelCase. `LoadSettingsUseCase` normalizes keys from kebab-case to camelCase after YAML parse, before returning raw objects. The Zod schemas only accept camelCase keys.
- **YAML ↔ Schema structural mapping**: `LoadSettingsUseCase` owns the structural transformation from YAML format to schema format. Specifically: `modelProfiles` (after kebab normalization) → `modelRouting.profiles`. This reshape happens in `LoadSettingsUseCase` alongside key normalization, so `MergeSettingsUseCase` receives objects that match the schema shape. Additional `modelRouting` sub-keys (`complexityMapping`, `phaseOverrides`, `budget`) are new schema-only fields with defaults — they don't need to exist in YAML.

### Value Object

`ProjectSettings` — immutable, created via `ProjectSettings.create(props)` which validates through `SettingsSchema`. `reconstitute(props)` for loading pre-validated data. Getter methods for each config section.

### Types

```typescript
type RawSettingsSources = {
  team: Record<string, unknown> | null;   // from settings.yaml
  local: Record<string, unknown> | null;  // from settings.local.yaml
  env: Record<string, unknown>;           // from TFF_* env vars (always present, may be {})
}
```

### Use Cases

1. **LoadSettingsUseCase** — depends on `SettingsFilePort` and `EnvVarPort`
   - Reads `settings.yaml` (team) and `settings.local.yaml` (local) via `SettingsFilePort`
   - Reads recognized `TFF_*` env vars via `EnvVarPort` and builds the env object
   - Parses YAML → raw objects, normalizes kebab-case keys to camelCase, reshapes `modelProfiles` → `modelRouting.profiles`
   - Missing files return `null` for that source (not an error — cascade continues with remaining layers)
   - Syntactically invalid YAML (unparseable) → treated as missing (returns `null` for that source, logs a warning)
   - Requires `yaml` npm package for YAML parsing
   - Signature: `execute(projectRoot: string): Promise<Result<RawSettingsSources, SettingsFileError>>`

2. **MergeSettingsUseCase** — pure function, no port dependencies
   - Deep-merges raw objects: hardcoded defaults < team < local < env vars
   - **Deep-merge semantics**: arrays are **replaced** (not concatenated). Deep-merge applies only to plain objects. A `fallbackChain` in local settings fully replaces the team setting's `fallbackChain`.
   - Validates merged result through `SettingsSchema`
   - Always succeeds (`.default()` + `.catch()` guarantee valid output)
   - Signature: `execute(sources: RawSettingsSources): Result<ProjectSettings, never>`

3. **ResolveModelUseCase** — depends on `BudgetTrackingPort`
   - Resolution chain: complexity tier → profile name → model
   - Phase override: `phaseOverrides[phase]` can override the complexity-based profile
   - Budget downshift: thresholds evaluated **highest-first** (75% before 50%). At `>= 75%` → downshift to budget; at `>= 50%` → downshift to balanced. Downshift only applies when the resolved profile is higher than the target (budget profile is never downshifted further).
   - Fallback: accepts an optional `unavailableModels: ModelName[]` parameter. If the resolved model is in this set, walks the profile's `fallbackChain` and returns the first model not in `unavailableModels`. If the entire chain is exhausted, returns the last model in the chain (assumed available as terminal fallback).
   - Signature: `execute(params: { phase: string, complexity: ComplexityTier, settings: ProjectSettings, unavailableModels?: ModelName[] }): Promise<Result<ModelName, never>>`

### Ports

1. **SettingsFilePort** — `readFile(path: string): Promise<Result<string | null, SettingsFileError>>`
2. **BudgetTrackingPort** — `getUsagePercent(): Promise<Result<number, never>>`
3. **EnvVarPort** — `get(key: string): string | undefined`

### Adapters

| Adapter | Implements | Purpose |
|---------|-----------|---------|
| FsSettingsFileAdapter | SettingsFilePort | Node fs file reading |
| InMemorySettingsFileAdapter | SettingsFilePort | Testing |
| AlwaysUnderBudgetAdapter | BudgetTrackingPort | Stub (always 0%) |
| ProcessEnvVarAdapter | EnvVarPort | `process.env` wrapper |
| InMemoryEnvVarAdapter | EnvVarPort | Testing |

### Env Var Convention

Hardcoded mapping (not algorithmic) — only these env vars are recognized:

| Env Var | Maps To |
|---------|---------|
| `TFF_MODEL_QUALITY` | `modelRouting.profiles.quality.model` |
| `TFF_MODEL_BALANCED` | `modelRouting.profiles.balanced.model` |
| `TFF_MODEL_BUDGET` | `modelRouting.profiles.budget.model` |
| `TFF_AUTONOMY_MODE` | `autonomy.mode` |
| `TFF_AUTONOMY_MAX_RETRIES` | `autonomy.maxRetries` |
| `TFF_BEADS_TIMEOUT` | `beads.timeout` |

New env vars are added by extending the hardcoded map — no auto-discovery.

### 4-Layer Cascade

```
Priority (lowest → highest):
1. Hardcoded defaults (baked into Zod .default() values)
2. Team settings (.tff/settings.yaml)
3. Local settings (.tff/settings.local.yaml)
4. Environment variables (TFF_* prefix)
```

### File Structure

```
src/hexagons/settings/
├── domain/
│   ├── project-settings.value-object.ts
│   ├── project-settings.value-object.spec.ts
│   ├── project-settings.schemas.ts
│   ├── project-settings.schemas.spec.ts
│   ├── project-settings.builder.ts
│   ├── errors/
│   │   └── settings-file.error.ts
│   └── ports/
│       ├── settings-file.port.ts
│       ├── budget-tracking.port.ts
│       └── env-var.port.ts
├── use-cases/
│   ├── load-settings.use-case.ts
│   ├── load-settings.use-case.spec.ts
│   ├── merge-settings.use-case.ts
│   ├── merge-settings.use-case.spec.ts
│   ├── resolve-model.use-case.ts
│   └── resolve-model.use-case.spec.ts
├── infrastructure/
│   ├── fs-settings-file.adapter.ts
│   ├── in-memory-settings-file.adapter.ts
│   ├── always-under-budget.adapter.ts
│   ├── process-env-var.adapter.ts
│   ├── in-memory-env-var.adapter.ts
│   └── settings-file.contract.spec.ts
└── index.ts
```

## Acceptance Criteria

1. **AC1: Resilient field-level defaults** — Partial/corrupted YAML falls back to defaults per field, not entire file. Each top-level section (modelRouting, autonomy, autoLearn, beads) is independently recoverable via `.catch()`. A corrupted `autonomy` section does not affect `modelRouting`.
2. **AC2: Complete defaults from empty input** — `{}` (empty YAML) produces a fully valid `ProjectSettings` with all defaults populated.
3. **AC3: 4-layer cascade** — Settings merge in order: hardcoded defaults < `settings.yaml` < `settings.local.yaml` < `TFF_*` env vars. Higher priority sources override lower ones.
4. **AC4: Complexity tier mapping** — Model routing maps S → budget, F-lite → balanced, F-full → quality by default.
5. **AC5: Budget enforcement** — At `>= 50%` budget consumed → downshift to balanced profile; at `>= 75%` → downshift to budget profile. Downshift only applies when the resolved profile is higher than the target; budget profile is never downshifted further.
6. **AC6: Fallback chains** — When `unavailableModels` includes the resolved model, `ResolveModelUseCase` walks the profile's `fallbackChain` and returns the first model not in `unavailableModels`. If the entire chain is exhausted, the last model in the chain is returned as terminal fallback.
7. **AC7: Phase overrides** — `phaseOverrides` map can override the complexity-based profile for specific workflow phases.
8. **AC8: Missing and malformed files** — When `settings.yaml` or `settings.local.yaml` does not exist or contains syntactically invalid YAML, `LoadSettingsUseCase` returns `null` for that source (not an error), and the cascade proceeds with the remaining layers.
9. **AC9: Kebab-case normalization** — YAML files using kebab-case keys (e.g., `model-profiles`, `max-retries`) are normalized to camelCase before schema validation.
10. **AC10: Env var mapping** — Each recognized `TFF_*` env var correctly maps to its nested config path (e.g., `TFF_AUTONOMY_MODE=guided` sets `autonomy.mode`).

## Non-Goals

- No write/save — settings are read-only from the domain
- No settings CLI commands (that's M02-S07)
- No hot-reload / file watching
- No dolt remote config

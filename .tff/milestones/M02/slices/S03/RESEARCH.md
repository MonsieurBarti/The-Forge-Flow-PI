# M02-S03: Settings Hexagon — Research Notes

## 1. Zod 4 `.default()` and `.catch()` Behavior

### `.default()` — Verified Non-Cascading

**Zod version**: 4.3.6 (confirmed in `node_modules/zod/package.json`)

The spec's claim is **correct**: parent `.default({})` provides `{}` literally — it does NOT cascade through inner schemas. Verified via Zod 4 test suite (`default.test.ts:83-95`):

```typescript
const inner = z.string().default("asdf");
const outer = z.object({ inner }).default({ inner: "qwer" });

outer.parse(undefined) // → { inner: "qwer" }  ← parent default, literal replacement
outer.parse({})        // → { inner: "asdf" }  ← inner default fires because field is undefined
```

**Implementation**: `handleDefaultResult()` in core/schemas.ts does a simple `payload.value = def.defaultValue` — no merge logic.

**Implication**: Each sub-schema's `.default()` must provide **fully-hydrated default objects**, not `{}`. But when the parent object is provided (even as `{}`), inner `.default()` values DO fire for missing fields. So the key risk is only when the parent is `undefined` — then the parent's `.default()` replaces entirely.

### `.catch()` — Verified Field-Level Isolation

Confirmed via Zod 4 test suite (`catch.test.ts:145-212`): each `.catch()` clears issues independently. A corrupted `autonomy` sub-schema triggers its own `.catch()` fallback without affecting `modelRouting`.

Implementation: `inst._zod.parse` catches errors, replaces with `def.catchValue`, and clears `payload.issues` for that field only.

### Direction-Aware Behavior

Both `.default()` and `.catch()` apply only in **forward direction** (parse/decode). In reverse direction (encode), they do NOT apply — strict validation. This is ideal: resilient loading, strict serialization.

### Schema Strategy

```typescript
// Each sub-schema: .catch() with fully-hydrated fallback
const SettingsSchema = z.object({
  modelRouting: ModelRoutingConfigSchema.catch(MODEL_ROUTING_DEFAULTS),
  autonomy: AutonomyConfigSchema.catch(AUTONOMY_DEFAULTS),
  autoLearn: AutoLearnConfigSchema.catch(AUTO_LEARN_DEFAULTS),
  beads: BeadsConfigSchema.catch(BEADS_DEFAULTS),
});

// Top-level .default() for when entire input is undefined
// Must provide fully-hydrated object
const SettingsWithDefault = SettingsSchema.default({
  modelRouting: MODEL_ROUTING_DEFAULTS,
  autonomy: AUTONOMY_DEFAULTS,
  autoLearn: AUTO_LEARN_DEFAULTS,
  beads: BEADS_DEFAULTS,
});
```

## 2. YAML Parsing

### Library Choice

**`yaml` ^2.8.3** — already used by tff-tools. Proven against actual `settings.yaml` files. Handles all features present in current YAML (nested objects, comments, numbers, floats, enums, kebab-case keys). No YAML anchors or multi-line strings needed.

**Action**: Add `yaml: ^2.8.3` to PI `package.json` dependencies.

### Deep-Merge

**No library needed.** Implement inline (~20 lines). The spec explicitly states arrays are **replaced** not concatenated. Deep-merge applies only to plain objects. This is simpler than any library's default behavior.

```typescript
function deepMerge(target: unknown, source: unknown): unknown {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    result[key] = Array.isArray(source[key])
      ? source[key]                           // arrays: replace
      : deepMerge(result[key], source[key]);  // objects: recurse
  }
  return result;
}
```

## 3. ProjectSettings — Not a ValueObject

### ValueObject Base Incompatibility

`ValueObject<TProps>` calls `schema.parse(props)` in constructor — strict validation that **throws on error**. Settings need `.catch()` resilience where parse errors are caught and replaced with defaults.

**Decision**: ProjectSettings is a **standalone class**, not extending `ValueObject` or `AggregateRoot`.

```typescript
export class ProjectSettings {
  private constructor(private readonly props: SettingsProps) {}

  static create(raw: unknown): ProjectSettings {
    // Schema has .catch() throughout — parse always succeeds
    const validated = SettingsSchema.parse(raw);
    return new ProjectSettings(validated);
  }

  static reconstitute(props: SettingsProps): ProjectSettings {
    return new ProjectSettings(props);
  }

  // Read-only getters
  get modelRouting(): ModelRoutingConfig { return this.props.modelRouting; }
  get autonomy(): AutonomyConfig { return this.props.autonomy; }
  // ...
}
```

## 4. Existing Hexagon Patterns to Follow

### File Placement

- **Ports**: abstract classes in `domain/ports/*.port.ts`
- **Errors**: extend `BaseDomainError`, code format `SETTINGS.{ERROR_TYPE}`
- **Schemas**: Zod with inferred types, kernel schemas for Id/Timestamp
- **Builders**: colocated in `domain/`, fluent chaining, two build methods (`build()` and `buildProps()`)
- **Barrel exports**: errors, ports, schemas/types (NOT aggregates/builders/use-cases)

### Use Case Placement — Intentional Deviation

Existing hexagons place use cases inside `domain/` (e.g., `task/domain/detect-waves.use-case.ts`). The spec places use cases in a **top-level `use-cases/` folder** — this is an intentional new pattern for Settings since:
- Settings use cases have infrastructure dependencies (SettingsFilePort, EnvVarPort)
- They are application-layer concerns, not pure domain logic
- `DetectWavesUseCase` extends `WaveDetectionPort` (it IS a port implementation), while settings use cases CONSUME ports

### Contract Test Pattern

Generic `runContractTests(name, factory)` function. Factory returns port + `reset()`. Reusable across InMemory and Sqlite implementations. For Settings: `settings-file.contract.spec.ts` tests `SettingsFilePort` with both `FsSettingsFileAdapter` and `InMemorySettingsFileAdapter`.

### Adapter Pattern

- Stores props, not objects (serializable state)
- All methods async (match port signature)
- Returns `Result` type
- `seed()` and `reset()` methods for testing (not in port)

## 5. Key Normalization: Kebab to CamelCase

The YAML file uses kebab-case (`model-profiles`, `max-retries`, `cooldown-days`). Schemas use camelCase. Transformation happens in `LoadSettingsUseCase` after YAML parse.

Simple recursive key transformer:
```typescript
function kebabToCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function normalizeKeys(obj: unknown): unknown {
  if (!isPlainObject(obj)) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [kebabToCamelCase(k), normalizeKeys(v)])
  );
}
```

## 6. Structural Reshape: YAML → Schema

The YAML top-level key `model-profiles` (→ `modelProfiles` after kebab normalization) maps to `modelRouting.profiles` in the schema. This structural reshape also happens in `LoadSettingsUseCase`:

```typescript
function reshapeToSchema(normalized: Record<string, unknown>): Record<string, unknown> {
  const { modelProfiles, ...rest } = normalized;
  return {
    ...rest,
    modelRouting: { profiles: modelProfiles },
  };
}
```

## 7. Dependencies to Add

| Package | Version | Purpose |
|---------|---------|---------|
| `yaml` | `^2.8.3` | YAML parsing (matches tff-tools) |

No other dependencies needed. Deep-merge is inline. Zod is already installed.

## 8. Open Questions — Resolved

| Question | Resolution |
|----------|-----------|
| Zod `.default()` cascades? | No — parent defaults are literal. Use fully-hydrated objects. |
| `.catch()` isolated per field? | Yes — verified in Zod 4 source + tests. |
| ValueObject compatible? | No — strict parse throws. Use standalone class. |
| YAML library? | `yaml@^2.8.3` (proven in tff-tools). |
| Deep-merge library? | Not needed — inline with array-replace semantics. |
| Use case placement? | Top-level `use-cases/` — intentional deviation, justified. |

# Research — M06-S03: pi-tui Foundation

## Investigation Areas

### 1. ctx.ui.custom() Promise Resolution

**Finding:** `ctx.ui.custom<T>()` returns `Promise<T>` that resolves **only when the factory calls `done(result)`**. For persistent overlays that never call `done()`, the Promise never resolves.

**Impact on spec:** The toggle handler MUST NOT `await ctx.ui.custom()`. If awaited, the handler hangs forever and subsequent shortcut keypresses won't fire (if PI runtime serializes handler calls).

**Corrected pattern:**
```typescript
const toggleOverlay = (
  ctx: ExtensionContext,
  handle: OverlayHandle | undefined,
  factory: OverlayFactory,
  setHandle: (h: OverlayHandle) => void,
) => {
  if (!ctx.hasUI) return;
  if (handle) {
    handle.setHidden(!handle.isHidden());
  } else {
    // Fire-and-forget — do NOT await
    // onHandle callback fires synchronously when overlay is created
    ctx.ui.custom(factory, {
      overlay: true,
      overlayOptions: { anchor: "center", width: "80%" },
      onHandle: setHandle,
    });
  }
};
```

Handler signature changes from `async` to sync. The `onHandle` callback fires when the overlay is created (before `done()` would resolve the Promise), so the handle is captured immediately.

**Exact signature:**
```typescript
custom<T>(
  factory: (
    tui: TUI, theme: Theme, keybindings: KeybindingsManager,
    done: (result: T) => void
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: {
    overlay?: boolean;
    overlayOptions?: OverlayOptions | (() => OverlayOptions);
    onHandle?: (handle: OverlayHandle) => void;
  }
): Promise<T>
```

### 2. KeyId Format Validation

**Finding:** `KeyId` is a template literal type:
```typescript
type KeyId = BaseKey | `ctrl+${BaseKey}` | `ctrl+alt+${BaseKey}` | ...
```
Where `BaseKey = Letter | Digit | SymbolKey | SpecialKey`.

- `"ctrl+alt+d"` — valid (matches `ctrl+alt+${Letter}`)
- `"ctrl+alt+w"` — valid
- `"ctrl+alt+e"` — valid

Helper available: `Key.ctrlAlt("d")` returns `"ctrl+alt+d"` with type safety.

**Recommendation:** Use `Key.ctrlAlt()` helper in the implementation for type-safe key IDs.

### 3. registerShortcut Behavior

**Exact signature:**
```typescript
registerShortcut(
  shortcut: KeyId,
  options: {
    description?: string;
    handler: (ctx: ExtensionContext) => Promise<void> | void;
  }
): void
```

**Conflict behavior:** Does NOT throw. Same-extension shortcuts silently overwrite. Cross-extension conflicts tracked by `KeybindingsManager.getConflicts()`. The `registerSafe` try-catch in the spec is still useful for unexpected runtime errors (e.g., invalid key format).

**Handler receives `ExtensionContext`** (base interface), not `ExtensionCommandContext`. Has `ui: ExtensionUIContext` and `hasUI: boolean`.

### 4. Settings Architecture Gap

**Finding:** `ProjectSettings` class currently has NO `.hotkeys` getter. Only exposes:
- `.modelRouting` (ModelRoutingConfig)
- `.autonomy` (AutonomyConfig)
- `.autoLearn` (AutoLearnConfig)
- `.beads` (BeadsConfig)
- `.toJSON()` → SettingsProps

**`MergeSettingsUseCase.execute()` signature:**
```typescript
execute(sources: RawSettingsSources): Result<ProjectSettings, never>
```
Where `RawSettingsSources = { team: Record<string, unknown> | null; local: Record<string, unknown> | null; env: Record<string, unknown> }`. It's synchronous and never fails.

**Impact:** S03 must:
1. Add `HotkeysConfigSchema` to `project-settings.schemas.ts`
2. Add `hotkeys` to `SettingsProps` type
3. Add `hotkeys` getter to `ProjectSettings` class
4. Add to `SETTINGS_DEFAULTS`
5. Add env var mappings to `ENV_VAR_MAP`
6. Add YAML key mapping for `hotkeys.*`

**Settings loading at extension init:** The existing pattern in `extension.ts` doesn't load settings eagerly. YAML file reading happens elsewhere (via `registerProjectExtension` → project init). For overlay registration at init time:
- Option A: Read `settings.yaml` directly via `fs.readFileSync` + `yaml.parse` + feed into `MergeSettingsUseCase`
- Option B: Use `HOTKEYS_DEFAULTS` at init, make hotkeys non-configurable until lazy-loaded
- **Recommended: Option A** — simple, synchronous, consistent with settings hexagon pattern

### 5. Repository Port Signatures (Verified)

| Port | Method | Signature |
|------|--------|-----------|
| `ProjectRepositoryPort` | `findSingleton()` | `() → Promise<Result<Project \| null, PersistenceError>>` |
| `MilestoneRepositoryPort` | `findByProjectId(projectId)` | `(Id) → Promise<Result<Milestone[], PersistenceError>>` |
| `SliceRepositoryPort` | `findByMilestoneId(milestoneId)` | `(Id) → Promise<Result<Slice[], PersistenceError>>` |
| `TaskRepositoryPort` | `findBySliceId(sliceId)` | `(Id) → Promise<Result<Task[], PersistenceError>>` |

**Active milestone detection:** No `getActive()` method. Must `findByProjectId()` then filter where `status !== "closed"`. `MilestoneStatus = "open" | "in_progress" | "closed"`.

### 6. Domain Entity Shapes

| Entity | Status field | Status values |
|--------|-------------|---------------|
| `Project` | No status | — |
| `Milestone` | `status` | `"open" \| "in_progress" \| "closed"` |
| `Slice` | `status` | 8 states: `discussing → ... → closed` |
| `Task` | `status` | `"open" \| "in_progress" \| "closed" \| "blocked"` |

All use `Id = string` (UUID format). All have `createdAt` and `updatedAt` timestamps.

**Task.waveIndex:** `number | null` — wave assignment for parallel execution. Useful for future overlay rendering.

### 7. Box/Text Component Constructors

```typescript
class Box implements Component {
  constructor(paddingX?: number, paddingY?: number, bgFn?: (text: string) => string);
  addChild(component: Component): void;
  removeChild(component: Component): void;
  clear(): void;
  invalidate(): void;
  render(width: number): string[];
}

class Text implements Component {
  constructor(text?: string, paddingX?: number, paddingY?: number, customBgFn?: (text: string) => string);
  setText(text: string): void;
  invalidate(): void;
  render(width: number): string[];
}
```

All parameters optional. Placeholder factory `new Box(2, 1)` + `new Text("...")` → `box.addChild(text)` is valid.

### 8. Kernel Ports Barrel

Currently exports 7 ports: `AgentEventPort`, `DateProviderPort`, `EventBusPort`, `GitPort`, `GitHubPort`, `LoggerPort`, `StateSyncPort`.

Pattern: add `export { OverlayDataPort } from "./overlay-data.port"` and type exports to barrel.

## Spec Corrections Required

1. **toggleOverlay must NOT await ctx.ui.custom()** — fire-and-forget pattern. Handler should be sync, not async.
2. **Settings loading code** — replace pseudocode with actual pattern: read YAML file + parse + feed to MergeSettingsUseCase.
3. **ProjectSettings needs hotkeys getter** — additional code change not in original file impact.
4. **Use `Key.ctrlAlt()` helper** — for type-safe KeyId values instead of string literals.

## Updated File Impact

Original spec lists 3 new + 4 modified. Research adds:
- `src/hexagons/settings/domain/project-settings.ts` — **Modify** (add `hotkeys` getter to class)

Revised: **3 new + 5 modified**.

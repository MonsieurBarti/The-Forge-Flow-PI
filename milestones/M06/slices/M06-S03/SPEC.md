# S03: pi-tui Foundation

## Context

- **Milestone:** M06 — PI-Native Integration
- **Slice:** M06-S03
- **Wave:** 1 (depends on S01 + S02, prerequisite for S04-S06)
- **Complexity:** TBD (classified at end of discuss)

## Goal

Promote `@mariozechner/pi-tui` to direct dependency. Build overlay infrastructure: `OverlayDataPort` in kernel, persistent toggle lifecycle via PI SDK overlay API, hotkey registration with slash-command fallbacks, and 3 empty placeholder overlays.

## Scope

### In scope

- Add `@mariozechner/pi-tui` as direct dependency in `package.json`
- `OverlayDataPort` abstract class in `kernel/ports` — read-only queries for project/milestone/slice/task state
- `OverlayDataAdapter` implementation composing existing repository ports
- `overlay.extension.ts` with `registerOverlayExtension()` — follows existing extension pattern
- Persistent overlay toggle: `registerShortcut` → `ctx.ui.custom()` → `OverlayHandle.setHidden()`
- Default hotkeys: `ctrl+alt+d` (dashboard), `ctrl+alt+w` (workflow), `ctrl+alt+e` (execution monitor)
- `HotkeysConfig` sub-schema in settings hexagon (configurable via YAML + env vars)
- Slash command fallbacks: `/tff:dashboard`, `/tff:workflow-view`, `/tff:execution-monitor`
- Shared toggle state — hotkey and slash command reference the same overlay handle
- Conflict-safe shortcut registration: log warning on conflict, degrade to slash-command-only
- 3 empty placeholder overlay components that render without error

### Out of scope

- Rendering helpers (progress bars, phase badges, status chips) — built in S04-S06 as needed
- Actual dashboard/workflow/monitor content — S04-S06
- AgentEventPort subscription wiring for overlays — S06
- Domain EventBus subscription for re-render invalidation — S04-S06
- Any domain logic changes

## Design

### 1. OverlayDataPort — Kernel Port

New file: `src/kernel/ports/overlay-data.port.ts`

Read-only query facade returning domain types directly — no new DTOs.

```typescript
import type { Result } from "@kernel/result";
import type { Id } from "@kernel/id.schema";
import type { Project } from "@hexagons/project";
import type { Milestone } from "@hexagons/milestone";
import type { Slice } from "@hexagons/slice";
import type { Task } from "@hexagons/task";

export interface OverlayProjectSnapshot {
  project: Project | null;
  milestone: Milestone | null;
  slices: Slice[];
  taskCounts: Map<string, { done: number; total: number }>;
}

export interface OverlaySliceSnapshot {
  slice: Slice;
  tasks: Task[];
}

export abstract class OverlayDataPort {
  abstract getProjectSnapshot(): Promise<Result<OverlayProjectSnapshot>>;
  abstract getSliceSnapshot(sliceId: Id): Promise<Result<OverlaySliceSnapshot>>;
}
```

Key decisions:
- **Two query methods** — `getProjectSnapshot()` for dashboard, `getSliceSnapshot()` for workflow/monitor. S04-S06 may add more methods as specific needs arise.
- **`Result<T>` return type** — consistent with all existing ports.
- **No caching** — overlays re-query on each render. Domain data is already in-memory (InMemory* repos). No performance concern.
- **Domain types directly** — `Project`, `Milestone`, `Slice`, `Task` from their respective hexagons. No mapping layer.

### 2. OverlayDataAdapter — Infrastructure Implementation

New file: `src/cli/infrastructure/overlay-data.adapter.ts`

Placed alongside the extension code that consumes it (not in a new hexagon — a single adapter doesn't warrant its own hexagon).

Composes reads from existing repository ports:

```typescript
import { OverlayDataPort } from "@kernel/ports";
import type { ProjectRepositoryPort } from "@hexagons/project";
import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { TaskRepositoryPort } from "@hexagons/task";

export class OverlayDataAdapter extends OverlayDataPort {
  constructor(
    private projectRepo: ProjectRepositoryPort,
    private milestoneRepo: MilestoneRepositoryPort,
    private sliceRepo: SliceRepositoryPort,
    private taskRepo: TaskRepositoryPort,
  ) { super(); }

  async getProjectSnapshot(): Promise<Result<OverlayProjectSnapshot>> {
    const projectResult = await this.projectRepo.findSingleton();
    const project = projectResult.ok ? projectResult.data : null;
    // Active milestone: findByProjectId() + filter for non-closed
    // ... compose slices + task counts from milestone
  }

  async getSliceSnapshot(sliceId: Id): Promise<Result<OverlaySliceSnapshot>> {
    const slice = await this.sliceRepo.findById(sliceId);
    const tasks = await this.taskRepo.findBySliceId(sliceId);
    // ... compose into snapshot
  }
}
```

**Repository method mapping:**
- `ProjectRepositoryPort.findSingleton()` — returns the singleton project
- `MilestoneRepositoryPort.findByProjectId(projectId)` — returns all milestones; filter for active (non-closed) in adapter
- `SliceRepositoryPort.findByMilestoneId(milestoneId)` — returns slices for a milestone
- `TaskRepositoryPort.findBySliceId(sliceId)` — returns tasks for a slice

### 3. Settings — HotkeysConfig

Modified file: `src/hexagons/settings/domain/project-settings.schemas.ts`

New sub-schema:

```typescript
const HotkeysConfigSchema = z.object({
  dashboard: z.string().default("ctrl+alt+d"),
  workflow: z.string().default("ctrl+alt+w"),
  executionMonitor: z.string().default("ctrl+alt+e"),
});

export type HotkeysConfig = z.infer<typeof HotkeysConfigSchema>;

const HOTKEYS_DEFAULTS: HotkeysConfig = {
  dashboard: "ctrl+alt+d",
  workflow: "ctrl+alt+w",
  executionMonitor: "ctrl+alt+e",
};
```

Added to `SettingsSchema`:
```typescript
hotkeys: HotkeysConfigSchema.default(HOTKEYS_DEFAULTS),
```

New env var mappings in `ENV_VAR_MAP`:
```typescript
TFF_HOTKEY_DASHBOARD: ["hotkeys", "dashboard"],
TFF_HOTKEY_WORKFLOW: ["hotkeys", "workflow"],
TFF_HOTKEY_EXECUTION_MONITOR: ["hotkeys", "executionMonitor"],
```

YAML key mapping: `hotkeys.dashboard` / `hotkeys.workflow` / `hotkeys.execution-monitor`.

### 4. Overlay Registration & Toggle Lifecycle

New file: `src/cli/overlay.extension.ts`

Follows existing `register*Extension()` pattern from `workflow.extension.ts`, `project.extension.ts`, etc.

```typescript
import type { ExtensionAPI, ExtensionContext } from "@infrastructure/pi";
import type { OverlayHandle, Component, TUI, KeybindingsManager } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { OverlayDataPort } from "@kernel/ports";
import type { LoggerPort } from "@kernel/ports";
import type { HotkeysConfig } from "@hexagons/settings";
import { Text, Box } from "@mariozechner/pi-tui";

export interface OverlayExtensionDeps {
  overlayDataPort: OverlayDataPort;
  hotkeys: HotkeysConfig;
  logger: LoggerPort;
}

type OverlayFactory = (
  tui: TUI, theme: Theme, keybindings: KeybindingsManager,
  done: (result: void) => void,
) => Component & { dispose?(): void };
```

**Toggle mechanism:**

```typescript
const toggleOverlay = async (
  ctx: ExtensionContext,
  handle: OverlayHandle | undefined,
  factory: OverlayFactory,
  setHandle: (h: OverlayHandle) => void,
) => {
  if (!ctx.hasUI) return; // Guard: no-op in headless mode
  if (handle) {
    handle.setHidden(!handle.isHidden());
  } else {
    await ctx.ui.custom(factory, {
      overlay: true,
      overlayOptions: { anchor: "center", width: "80%" },
      onHandle: setHandle,
    });
  }
};
```

**Shortcut registration:**

```typescript
const registerSafe = (
  keyId: string, description: string,
  handler: (ctx: ExtensionContext) => Promise<void> | void,
) => {
  try {
    api.registerShortcut(keyId, { description, handler });
  } catch (e) {
    deps.logger.warn(`Shortcut registration failed for ${keyId} — use slash command instead`, { error: e });
  }
};
```

Note on conflict handling: `api.registerShortcut` within a single extension silently overwrites (same-extension shortcuts can't conflict). Cross-extension conflicts are resolved by the PI runtime. The try-catch guards against unexpected failures (invalid key IDs, runtime errors), not conflicts per se. Slash commands are the true always-available fallback.

**Placeholder factory:**

```typescript
const placeholderFactory = (name: string): OverlayFactory =>
  (_tui, _theme, _kb, _done) => {
    const box = new Box(2, 1);
    const text = new Text(`${name} (placeholder — content in S04-S06)`);
    box.addChild(text);
    return box;
  };
```

Note: `done()` is deliberately NOT called — the overlay stays persistent. Visibility controlled via `handle.setHidden()` toggle.

**Registration — 3 shortcuts + 3 commands:**

Each overlay gets:
1. A closure-scoped `OverlayHandle | undefined` variable
2. A `registerSafe()` call for the hotkey
3. A `registerCommand()` call for the slash command fallback
4. Both reference the same handle variable (shared toggle state)

Overlays registered:
- `ctrl+alt+d` / `/tff:dashboard` → Status Dashboard
- `ctrl+alt+w` / `/tff:workflow-view` → Workflow Visualizer
- `ctrl+alt+e` / `/tff:execution-monitor` → Execution Monitor

### 5. DI Wiring

Modified file: `src/cli/extension.ts`

At end of `createTffExtension()`, after existing `register*Extension()` calls:

```typescript
// Load settings for hotkey config. MergeSettingsUseCase already exists
// in the extension — invoke it eagerly to get hotkey defaults.
// Falls back to HOTKEYS_DEFAULTS if settings loading fails.
const mergeSettings = new MergeSettingsUseCase();
const settingsResult = mergeSettings.execute(/* projectRoot settings.yaml */);
const hotkeys = settingsResult.ok
  ? settingsResult.data.hotkeys
  : HOTKEYS_DEFAULTS;

const overlayDataAdapter = new OverlayDataAdapter(
  projectRepo, milestoneRepo, sliceRepo, taskRepo,
);
registerOverlayExtension(api, {
  overlayDataPort: overlayDataAdapter,
  hotkeys,
  logger,
});
```

**Settings loading:** `MergeSettingsUseCase` is already instantiated in `createTffExtension()` (line 122) for `registerProjectExtension`. Reuse the same instance or invoke it once and share. Hotkey configuration is read at extension init time — changing hotkeys requires reloading the extension (consistent with how all PI extension settings work).

## File Impact

| File | Action |
|------|--------|
| `package.json` | Add `@mariozechner/pi-tui` direct dependency |
| `src/kernel/ports/overlay-data.port.ts` | **New** — OverlayDataPort abstract class + snapshot types |
| `src/kernel/ports/index.ts` | **Modify** — export OverlayDataPort |
| `src/cli/infrastructure/overlay-data.adapter.ts` | **New** — OverlayDataAdapter composing repos |
| `src/hexagons/settings/domain/project-settings.schemas.ts` | **Modify** — add HotkeysConfig |
| `src/cli/overlay.extension.ts` | **New** — registerOverlayExtension() |
| `src/cli/extension.ts` | **Modify** — wire OverlayDataAdapter + call registerOverlayExtension() |

**New files:** 3 | **Modified files:** 4

## Acceptance Criteria

1. `@mariozechner/pi-tui` is a direct dependency in `package.json`
2. `OverlayDataPort` in kernel provides read-only domain state queries (`getProjectSnapshot`, `getSliceSnapshot`)
3. Persistent overlay toggle works — `setHidden(true/false)`, not create-destroy
4. Hotkey and slash command for the same overlay share a single `OverlayHandle` instance
5. Hotkeys configurable via settings schema (YAML + env vars); defaults: `ctrl+alt+d`, `ctrl+alt+w`, `ctrl+alt+e`
6. Slash command fallbacks (`/tff:dashboard`, `/tff:workflow-view`, `/tff:execution-monitor`) always available
7. Shortcut registration failure (invalid key, runtime error) logged as warning; slash commands still work
8. All 3 placeholder overlays render without error
9. Overlay toggle is a no-op when `ctx.hasUI` is false (headless/non-interactive mode)
10. All existing tests pass — no domain logic regressions
11. New tests: OverlayDataPort contract, OverlayDataAdapter, overlay registration + toggle lifecycle

## Risks

| Risk | Mitigation |
|------|------------|
| `ctx.ui.custom()` Promise never resolves if `done()` not called | Intentional for persistent overlays. Toggle via `setHidden()`. Verify behavior in integration test. |
| `registerShortcut` silently overwrites within same extension | Same-extension shortcuts can't conflict (single Map). Cross-extension conflicts handled by PI runtime. `registerSafe` guards unexpected failures. |
| `ctx.ui` not available in headless/non-interactive mode | Guard with `ctx.hasUI` check before overlay creation (AC #9) |
| OverlayDataPort query methods insufficient for S04-S06 | Methods added incrementally as overlay slices define needs. Current 2-method surface is deliberately minimal. |
| Settings not loaded at extension init | `MergeSettingsUseCase` invoked eagerly; falls back to `HOTKEYS_DEFAULTS` on failure. |

## Notes

- R03 says "depends on R02 (`AgentEventPort`)". S02 is closed — `AgentEventPort` exists in kernel. However, S03 does not wire overlays to `AgentEventPort`. That's S06's concern (Execution Monitor will subscribe to agent events for live streaming).
- The overlay infrastructure is deliberately dependency-free from domain event subscriptions. S04-S06 each wire their own EventBus subscriptions for re-render invalidation.
- **R03 scope deviation:** R03 mentions "Base rendering helpers: progress bars, phase badges, status chips." These are deliberately deferred to S04-S06 — each overlay builds its own rendering components as needed, avoiding speculative abstractions. If shared helpers emerge organically, they'll be extracted during S04-S06.

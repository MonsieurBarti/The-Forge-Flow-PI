# S04: Status Dashboard Overlay

## Context

- **Milestone:** M06 — PI-Native Integration
- **Slice:** M06-S04
- **Wave:** 2 (depends on S03 — pi-tui Foundation)
- **Complexity:** F-lite

## Goal

Replace the placeholder dashboard overlay with a live Status Dashboard that renders project state as a Markdown document via pi-tui's `Markdown` component. Auto-refreshes on domain events.

## Scope

### In scope

- `DashboardComponent` implementing `Component` — wraps pi-tui `Markdown` with async data loading
- Dashboard content rendered as a markdown string: project name, milestone progress, slice table, task counts, budget %, next suggested action
- Progress bar as Unicode block characters embedded in markdown text
- Phase badges as text labels in the slice table
- "Next action" heuristic: map active slice status to next tff command
- Replace placeholder factory in `overlay.extension.ts` with real dashboard factory
- Expand `OverlayExtensionDeps` with `eventBus: EventBusPort` and `budgetTrackingPort: BudgetTrackingPort`
- EventBus subscription for live refresh: `SLICE_STATUS_CHANGED`, `TASK_COMPLETED`, `TASK_CREATED`, `MILESTONE_CLOSED`
- Responsive layout via `Markdown.render(width)` — content adapts to terminal width (min 80 cols)
- Wire new deps in `extension.ts`

### Out of scope

- Implementing a real `BudgetTrackingPort` (remains `AlwaysUnderBudgetAdapter` — stub returns 0%)
- Domain logic changes
- AgentEventPort subscription (S06)
- Interactive elements — dashboard is read-only
- Overlay focus/keyboard navigation
- Custom `Box`/`Text` component tree — use `Markdown` component instead
- Changes to `OverlayDataPort` interface — current `getProjectSnapshot()` provides all needed data
- Tests for pi-tui rendering output (third-party component)

## Design

### 1. DashboardComponent — Component Wrapper

New file: `src/cli/components/dashboard.component.ts`

Wraps pi-tui `Markdown` with async data loading and event-driven refresh.

```typescript
import type { Component, TUI } from "@mariozechner/pi-tui";
import { Markdown } from "@mariozechner/pi-tui";
import type { MarkdownTheme } from "@mariozechner/pi-tui";
import type { OverlayDataPort, OverlayProjectSnapshot } from "@kernel/ports/overlay-data.port";
import type { BudgetTrackingPort } from "@hexagons/settings/domain/ports/budget-tracking.port";

interface DashboardState {
  snapshot: OverlayProjectSnapshot | null;
  budgetPercent: number;
  loading: boolean;
}

export class DashboardComponent implements Component {
  private markdown: Markdown;
  private state: DashboardState = { snapshot: null, budgetPercent: 0, loading: true };

  constructor(
    private readonly tui: TUI,
    private readonly overlayData: OverlayDataPort,
    private readonly budgetTracking: BudgetTrackingPort,
    markdownTheme: MarkdownTheme,
    paddingX: number,
    paddingY: number,
  ) {
    this.markdown = new Markdown("Loading dashboard...", paddingX, paddingY, markdownTheme);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const [snapshotResult, budgetResult] = await Promise.all([
      this.overlayData.getProjectSnapshot(),
      this.budgetTracking.getUsagePercent(),
    ]);

    this.state = {
      snapshot: snapshotResult.ok ? snapshotResult.data : null,
      budgetPercent: budgetResult.ok ? budgetResult.data : 0,
      loading: false,
    };

    this.markdown.setText(this.buildMarkdown());
    this.markdown.invalidate();
    this.tui.requestRender();
  }

  invalidate(): void {
    this.markdown.invalidate();
  }

  render(width: number): string[] {
    return this.markdown.render(width);
  }

  private buildMarkdown(): string {
    // See section 2 below
  }
}
```

**Data flow:**
```
Constructor → refresh() → query OverlayDataPort + BudgetTrackingPort
           → buildMarkdown() → markdown.setText()
           → markdown.invalidate() → tui.requestRender()
           → TUI schedules doRender() via process.nextTick()
           → Markdown.render(width) called by TUI

EventBus event → refresh() → same cycle
```

Key decisions:
- **Composition over inheritance** — wraps `Markdown` rather than extending it. Cleaner separation of data logic and rendering.
- **TUI reference for re-renders** — `component.invalidate()` only clears caches; `tui.requestRender()` is required to schedule an actual re-render (research finding U1). The factory passes `tui` from its first argument.
- **Async refresh, sync render** — `refresh()` is async (queries ports), `render()` is sync (delegates to Markdown). State cached between cycles.
- **Loading state** — first render shows "Loading dashboard..." until async data arrives.
- **`refresh()` is public** — called by the overlay extension on EventBus events.

### 2. Markdown Content Template

The `buildMarkdown()` method generates a markdown string from cached state:

```markdown
# {project.name}

## {milestone.label} — {milestone.title}  {progressBar} {done}/{total} tasks

| Slice | Phase | Tasks | Complexity |
|-------|-------|-------|------------|
| {label} | {status badge} | {done}/{total} | {complexity ?? "—"} |
| ... | ... | ... | ... |

**Budget:** {progressBar} {percent}%

**Next:** `{suggestedCommand}` — {description}
```

**Progress bar format:** `[████████░░░░░░░░] 50%` — 16-char bar using `█` (filled) and `░` (empty).

```typescript
function progressBar(percent: number, width = 16): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${percent}%`;
}
```

**Phase badge format:** plain text status — the `MarkdownTheme` handles styling. Table column shows the raw `SliceStatus` value (`discussing`, `executing`, `closed`, etc.).

**Next action heuristic:**

```typescript
const NEXT_ACTION: Record<SliceStatus, { cmd: string; desc: string }> = {
  discussing:  { cmd: "/tff:research", desc: "Research the current slice" },
  researching: { cmd: "/tff:plan",     desc: "Plan the current slice" },
  planning:    { cmd: "/tff:execute",  desc: "Execute the current slice" },
  executing:   { cmd: "/tff:verify",   desc: "Verify acceptance criteria" },
  verifying:   { cmd: "/tff:ship",     desc: "Ship the slice PR" },
  reviewing:   { cmd: "/tff:ship",     desc: "Complete the review" },
  completing:  { cmd: "/tff:complete-milestone", desc: "Complete the milestone" },
  closed:      { cmd: "/tff:status",   desc: "All slices closed" },
};
```

Logic: find the first non-closed slice in the milestone's slice list, look up its status. If all slices closed, suggest `/tff:complete-milestone`.

### 3. Overlay Factory Replacement

Modified file: `src/cli/overlay.extension.ts`

Replace the placeholder dashboard factory with the real `DashboardComponent`:

```typescript
import { DashboardComponent } from "./components/dashboard.component";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";

// In registerOverlayExtension():
let dashboardComponent: DashboardComponent | undefined;

const dashboardFactory: OverlayFactory = (tui, _theme, _kb, _done) => {
  dashboardComponent = new DashboardComponent(
    tui,
    deps.overlayDataPort,
    deps.budgetTrackingPort,
    getMarkdownTheme(),
    2, // paddingX
    1, // paddingY
  );
  return dashboardComponent;
};
```

The `toggleOverlay` call for dashboard uses `dashboardFactory` instead of `placeholderFactory("Status Dashboard")`.

Note: `_done` is deliberately NOT called — the overlay stays persistent, toggled via `setHidden()`.

### 4. EventBus Subscription for Live Refresh

Added in `registerOverlayExtension()` after overlay registration:

```typescript
import { EVENT_NAMES } from "@kernel/event-names";

const DASHBOARD_EVENTS: EventName[] = [
  EVENT_NAMES.SLICE_STATUS_CHANGED,
  EVENT_NAMES.TASK_COMPLETED,
  EVENT_NAMES.TASK_CREATED,
  EVENT_NAMES.MILESTONE_CLOSED,
];

for (const eventName of DASHBOARD_EVENTS) {
  deps.eventBus.subscribe(eventName, async () => {
    if (dashboardComponent) {
      await dashboardComponent.refresh();
    }
  });
}
```

The handler is a no-op if the dashboard hasn't been opened yet (no wasted queries). Once opened, every relevant domain event triggers a full data refresh + re-render.

### 5. Expanded OverlayExtensionDeps

Modified file: `src/cli/overlay.extension.ts`

```typescript
import type { EventBusPort } from "@kernel/ports/event-bus.port";
import type { BudgetTrackingPort } from "@hexagons/settings/domain/ports/budget-tracking.port";

export interface OverlayExtensionDeps {
  overlayDataPort: OverlayDataPort;
  budgetTrackingPort: BudgetTrackingPort;
  eventBus: EventBusPort;
  hotkeys: HotkeysConfig;
  logger: LoggerPort;
}
```

### 6. DI Wiring

Modified file: `src/cli/extension.ts`

Pass the new deps to `registerOverlayExtension()`:

```typescript
import { AlwaysUnderBudgetAdapter } from "@hexagons/settings/infrastructure/always-under-budget.adapter";

// ... in createTffExtension(), near overlay wiring:
const budgetTrackingAdapter = new AlwaysUnderBudgetAdapter();

registerOverlayExtension(api, {
  overlayDataPort: overlayDataAdapter,
  budgetTrackingPort: budgetTrackingAdapter,
  eventBus,
  hotkeys,
  logger,
});
```

`eventBus` is already instantiated at line 96 of `extension.ts`. `AlwaysUnderBudgetAdapter` needs to be imported and instantiated — it is not currently created anywhere in the extension (research finding U3).

## File Impact

| File | Action |
|------|--------|
| `src/cli/components/dashboard.component.ts` | **New** — DashboardComponent wrapping Markdown |
| `src/cli/overlay.extension.ts` | **Modify** — expand deps, replace placeholder factory, add EventBus subscriptions |
| `src/cli/extension.ts` | **Modify** — pass eventBus + budgetTrackingPort to overlay deps |

**New files:** 1 | **Modified files:** 2

## Acceptance Criteria

1. Dashboard shows project name, milestone label + title, and progress bar
2. Slice table displays label, phase status, task counts (done/total), and complexity tier
3. Budget section shows usage % from `BudgetTrackingPort`
4. "Next action" suggests the correct tff command based on the first non-closed slice's status
5. Dashboard auto-refreshes on `SLICE_STATUS_CHANGED`, `TASK_COMPLETED`, `TASK_CREATED`, `MILESTONE_CLOSED` events
6. Responsive layout adapts to terminal width via `Markdown.render(width)`
7. Dashboard renders without error when no project/milestone data exists (empty/loading state)
8. Existing overlay toggle behavior preserved — hotkey and slash command still share the same handle
9. All existing tests pass — no regressions
10. New tests: DashboardComponent data loading + markdown generation, EventBus refresh wiring

## Risks

| Risk | Mitigation |
|------|------------|
| Markdown table rendering may not handle long slice titles well | `Markdown.render(width)` handles wrapping. Test with narrow widths (80 cols). |
| Budget always shows 0% until real adapter exists | Expected — documented in scope. Real implementation planned for M07/M08. |

**Resolved during research:**
- ~~`invalidate()` re-render~~ — `tui.requestRender()` confirmed available; component stores TUI reference.
- ~~`getMarkdownTheme()` export~~ — confirmed exported from `@mariozechner/pi-coding-agent`, zero-arg, fully compatible with pi-tui `MarkdownTheme`.
- ~~EventBus subscription cleanup~~ — not needed; overlays and subscriptions share process lifetime.

## Notes

- S05 (Workflow Visualizer) and S06 (Execution Monitor) will follow the same pattern: replace their placeholder factories, add their own EventBus subscriptions, create their own components.
- The `OverlayExtensionDeps` expansion (adding `eventBus` + `budgetTrackingPort`) benefits S05/S06 too — they'll need the same deps.
- `getMarkdownTheme()` is a zero-arg function — it doesn't need the `Theme` instance from the factory. This simplifies the factory since we don't need to thread the theme parameter.

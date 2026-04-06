# Plan — M06-S04: Status Dashboard Overlay

## Task Decomposition

### Wave 1 (T01 ∥ T02)

#### T01: Expand OverlayExtensionDeps + DI Wiring

**Model:** Sonnet | **Est:** 2-3 min

Expand the `OverlayExtensionDeps` interface with `eventBus` and `budgetTrackingPort`. Update `extension.ts` to instantiate `AlwaysUnderBudgetAdapter` and pass both new deps.

**Files:**
- `src/cli/overlay.extension.ts` — add `EventBusPort` + `BudgetTrackingPort` imports, expand interface
- `src/cli/extension.ts` — import `AlwaysUnderBudgetAdapter`, instantiate it, pass `eventBus` + `budgetTrackingPort` to `registerOverlayExtension()`
- `src/cli/overlay.extension.spec.ts` — update mock deps to include new fields

**Steps:**
1. Add imports for `EventBusPort` and `BudgetTrackingPort` to `overlay.extension.ts`
2. Add `eventBus: EventBusPort` and `budgetTrackingPort: BudgetTrackingPort` to `OverlayExtensionDeps`
3. In `extension.ts`: import `AlwaysUnderBudgetAdapter`, create instance, add both to the `registerOverlayExtension()` call
4. Update `overlay.extension.spec.ts` mock deps to satisfy the expanded interface
5. Run tests — all existing tests pass

**AC:**
- `OverlayExtensionDeps` has 5 fields (overlayDataPort, budgetTrackingPort, eventBus, hotkeys, logger)
- `extension.ts` passes `eventBus` and `budgetTrackingPort` to `registerOverlayExtension()`
- All existing tests pass unchanged (no behavior change — new deps unused yet)

---

#### T02: DashboardComponent + Tests

**Model:** Opus | **Est:** 5-7 min

Create the `DashboardComponent` that wraps pi-tui `Markdown` with async data loading, markdown generation, and TUI-triggered re-rendering.

**Files:**
- `src/cli/components/dashboard.component.ts` — **new** component
- `src/cli/components/dashboard.component.spec.ts` — **new** test file

**Steps:**
1. Write tests first:
   - `buildMarkdown()` with full project snapshot → verifies heading, milestone progress bar, slice table, budget, next action
   - `buildMarkdown()` with null snapshot → shows "No project data" or similar empty state
   - `buildMarkdown()` with all slices closed → suggests `/tff:complete-milestone`
   - `refresh()` queries both ports, updates state, calls `markdown.setText()` + `invalidate()` + `tui.requestRender()`
   - `render()` delegates to `markdown.render(width)`
   - `progressBar()` helper: 0%, 50%, 100%, edge cases
   - Next action heuristic: each `SliceStatus` maps to correct command
2. Implement `DashboardComponent`:
   - Constructor: accepts `TUI`, `OverlayDataPort`, `BudgetTrackingPort`, `MarkdownTheme`, padding
   - `refresh()`: parallel query both ports, cache state, build markdown, invalidate + requestRender
   - `buildMarkdown()`: generate markdown string from cached state
   - `progressBar()`: Unicode block characters
   - `NEXT_ACTION` lookup table
   - `invalidate()` + `render()`: delegate to wrapped `Markdown`
3. Run tests — all pass

**AC:**
- `DashboardComponent` implements `Component` interface (render + invalidate)
- `buildMarkdown()` produces correct markdown for: full data, empty project, all-closed
- `progressBar()` renders correct bar at 0%, 50%, 100%
- `refresh()` calls `tui.requestRender()` after data load
- Next action heuristic maps all 8 `SliceStatus` values correctly

**Test mocking approach:**
- Mock `OverlayDataPort` with `vi.fn()` returning `ok(snapshot)` / `ok(null)`
- Mock `BudgetTrackingPort` with `vi.fn()` returning `ok(42)`
- Mock `TUI` with `{ requestRender: vi.fn() }`
- Mock `MarkdownTheme` with identity functions `(text) => text` for all fields
- For `render()` tests: create real `Markdown` instance (not mocked — it's the rendering engine)

---

### Wave 2 (T03, depends on T01 + T02)

#### T03: Factory Replacement + EventBus Subscriptions + Tests

**Model:** Sonnet | **Est:** 3-5 min

Replace the placeholder dashboard factory with the real `DashboardComponent` factory. Wire EventBus subscriptions for live refresh.

**Files:**
- `src/cli/overlay.extension.ts` — replace placeholder factory, add EventBus subscriptions
- `src/cli/overlay.extension.spec.ts` — add tests for factory + EventBus behavior

**Steps:**
1. Write tests first:
   - Dashboard factory creates `DashboardComponent` (not placeholder `Box`/`Text`)
   - EventBus subscription: publishing `SLICE_STATUS_CHANGED` triggers `refresh()` on component
   - EventBus subscription: no-op when dashboard not yet opened (no error, no wasted queries)
   - Existing toggle behavior preserved (hotkey + slash command share handle)
2. Implement:
   - Import `DashboardComponent` and `getMarkdownTheme`
   - Add `dashboardComponent` closure variable
   - Create `dashboardFactory` that instantiates `DashboardComponent` with `tui` + deps
   - Replace placeholder in `toggleOverlay` call for dashboard
   - Subscribe to `DASHBOARD_EVENTS` array, call `dashboardComponent.refresh()` on event
3. Run full test suite — all pass

**AC:**
- Placeholder factory replaced with `DashboardComponent` factory
- `getMarkdownTheme()` used for theme (not threading `_theme` from factory args)
- 4 EventBus subscriptions registered: `SLICE_STATUS_CHANGED`, `TASK_COMPLETED`, `TASK_CREATED`, `MILESTONE_CLOSED`
- Subscriptions are no-op before first dashboard toggle
- Workflow + Execution Monitor placeholders unchanged
- All existing + new tests pass

---

## Wave Summary

```
Wave 1:  T01 (deps+DI) ∥ T02 (component+tests)
Wave 2:  T03 (integration+tests) ← blocks on T01, T02
```

## File Ownership

| File | T01 | T02 | T03 |
|------|-----|-----|-----|
| `src/cli/overlay.extension.ts` | W1: interface | — | W2: factory+events |
| `src/cli/extension.ts` | W1: DI wiring | — | — |
| `src/cli/overlay.extension.spec.ts` | W1: mock update | — | W2: new tests |
| `src/cli/components/dashboard.component.ts` | — | W1: new | — |
| `src/cli/components/dashboard.component.spec.ts` | — | W1: new | — |

No file conflicts within a wave.

## Model Profile Rationale

- **T01 (Sonnet):** Mechanical interface expansion + DI plumbing. No design decisions.
- **T02 (Opus):** Core slice logic — markdown generation, refresh cycle, state management, heuristics. Most AC coverage.
- **T03 (Sonnet):** Straightforward integration — wire factory + subscribe events. Pattern established by S03.

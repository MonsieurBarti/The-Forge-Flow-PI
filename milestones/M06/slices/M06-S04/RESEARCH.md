# Research — M06-S04: Status Dashboard Overlay

## U1: Does `component.invalidate()` trigger a TUI re-render for overlays?

**Answer: No.** `invalidate()` only clears cached render output. A separate `tui.requestRender()` call is required.

### How the render cycle works

pi-tui uses a **push-based, deferred render system**:

1. `tui.requestRender()` schedules a render via `process.nextTick()` (batches multiple requests into one frame)
2. `doRender()` renders all children, then composites overlays on top via `compositeOverlays()`
3. Differential rendering: only changed lines are written to the terminal

### Component `invalidate()` behavior

`Box.invalidate()` and `Text.invalidate()` only clear internal caches (`this.cache = undefined`). They do **not** notify the TUI. The `Markdown` component inherits this behavior.

### How to trigger overlay re-renders

The overlay factory receives `tui: TUI` as its first argument. Store this reference and call `tui.requestRender()` after updating component state:

```typescript
// In DashboardComponent:
async refresh(): Promise<void> {
  // ... fetch data, build markdown ...
  this.markdown.setText(newText);
  this.markdown.invalidate();   // Clear cached render
  this.tui.requestRender();     // Schedule actual re-render
}
```

### Overlay handle methods

`OverlayHandle.setHidden()`, `.focus()`, `.unfocus()` all internally call `requestRender()`. So visibility toggles work correctly without manual render requests.

**Impact on SPEC:** `DashboardComponent` must accept and store a `TUI` reference. The factory passes it from its first argument.

---

## U2: Is `getMarkdownTheme()` exported from pi-coding-agent?

**Answer: Yes.** Fully available and compatible.

- **Import:** `import { getMarkdownTheme } from "@mariozechner/pi-coding-agent"`
- **Signature:** `() => MarkdownTheme` (zero arguments)
- **Compatibility:** Return type matches pi-tui's `MarkdownTheme` interface exactly (14/14 required properties + optional `highlightCode` provided)
- **Usage pattern:** All pi-coding-agent message components use `getMarkdownTheme()` as default for their markdown theme parameter

No concerns.

---

## U3: DI wiring gaps

### `eventBus` — available, not passed

`eventBus` is created at line 96 of `extension.ts` as `new InProcessEventBus(logger)`. It is in scope at line 350 where `registerOverlayExtension()` is called. Just needs to be added to the deps object.

### `AlwaysUnderBudgetAdapter` — not instantiated

No budget tracking adapter exists in `extension.ts`. The `AlwaysUnderBudgetAdapter` class exists at `src/hexagons/settings/infrastructure/always-under-budget.adapter.ts` but is never imported or instantiated in the main extension.

**Required:** Import and instantiate `AlwaysUnderBudgetAdapter` in `extension.ts`, pass to overlay deps.

### Current overlay wiring (lines 350-354)

```typescript
registerOverlayExtension(api, {
  overlayDataPort: overlayDataAdapter,
  hotkeys,
  logger,
});
```

**Needs to become:**

```typescript
const budgetTrackingAdapter = new AlwaysUnderBudgetAdapter();

registerOverlayExtension(api, {
  overlayDataPort: overlayDataAdapter,
  budgetTrackingPort: budgetTrackingAdapter,
  eventBus,
  hotkeys,
  logger,
});
```

---

## U4: Disposal of EventBus subscriptions

EventBus subscriptions in `registerOverlayExtension()` live for the extension lifetime. The `InProcessEventBus` stores handlers in a `Map` — no weak references, no auto-cleanup.

Since the extension (and its overlays) live for the entire PI host process lifetime, this is not a leak. No disposal mechanism needed.

---

## Summary of SPEC changes needed

| Finding | SPEC Impact |
|---------|-------------|
| `invalidate()` ≠ re-render | `DashboardComponent` must store `TUI` ref, call `tui.requestRender()` after `invalidate()` |
| `getMarkdownTheme()` available | No change — SPEC already uses it correctly |
| Budget adapter not instantiated | DI wiring section must include `new AlwaysUnderBudgetAdapter()` |
| No disposal needed | Risk table entry can be removed |

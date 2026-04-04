# Verification — M06-S03: pi-tui Foundation

## Acceptance Criteria Verdicts

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| AC1 | `@mariozechner/pi-tui` is a direct dependency | **PASS** | `package.json` line 20: `"@mariozechner/pi-tui": "^0.64.0"` |
| AC2 | `OverlayDataPort` provides `getProjectSnapshot` + `getSliceSnapshot` | **PASS** | `src/kernel/ports/overlay-data.port.ts` lines 17-18: both abstract methods defined. Exported from `src/kernel/ports/index.ts`. |
| AC3 | Persistent overlay toggle via `setHidden(true/false)` | **PASS** | `overlay.extension.ts` line 30: `handle.setHidden(!handle.isHidden())`. `done()` never called — overlay stays persistent. |
| AC4 | Hotkey and slash command share single `OverlayHandle` | **PASS** | `overlay.extension.ts` lines 63-74: both `registerSafe(...)` and `registerCommand(...)` call the same `toggleDashboard` closure referencing shared `dashboardHandle`. Same pattern for workflow (lines 77-88) and execution monitor (lines 91-103). |
| AC5 | Hotkeys configurable via settings (YAML + env vars) | **PASS** | `project-settings.schemas.ts`: `HotkeysConfigSchema` with defaults `ctrl+alt+d/w/e`. `ENV_VAR_MAP` entries: `TFF_HOTKEY_DASHBOARD`, `TFF_HOTKEY_WORKFLOW`, `TFF_HOTKEY_EXECUTION_MONITOR`. |
| AC6 | Slash command fallbacks always available | **PASS** | `overlay.extension.ts`: `api.registerCommand("tff:dashboard")`, `api.registerCommand("tff:workflow-view")`, `api.registerCommand("tff:execution-monitor")` — registered unconditionally outside try-catch. |
| AC7 | Shortcut failure logged as warning; slash commands still work | **PASS** | `overlay.extension.ts` line 55: `deps.logger.warn(...)` in catch block of `registerSafe()`. Commands registered after/outside the try-catch. Test `overlay.extension.spec.ts` "logs warning when shortcut registration fails" confirms. |
| AC8 | All 3 placeholder overlays render without error | **PASS** | `overlay.extension.ts` line 35: `new Text(\`${name} (placeholder — content in S04-S06)\`)` wrapped in `Box(2, 1)`. Three factory instances created for Dashboard, Workflow, Execution Monitor. |
| AC9 | Overlay toggle no-op when `ctx.hasUI` is false | **PASS** | `overlay.extension.ts` line 28: `if (!ctx.hasUI) return;`. Test "toggle is no-op when ctx.hasUI is false" confirms no throw. |
| AC10 | All existing tests pass | **PASS** | `npx vitest run` → 1643 PASS, 0 FAIL. `npx tsc --noEmit` → clean. |
| AC11 | New tests: OverlayDataPort, OverlayDataAdapter, overlay extension | **PASS** | 3 new spec files: `overlay-data.port.spec.ts` (3 tests), `overlay-data.adapter.spec.ts` (5 tests), `overlay.extension.spec.ts` (6 tests) — all 14 pass. |

## Summary

**Verdict: PASS** — all 11 acceptance criteria met with evidence.

### Test Coverage
- `overlay-data.port.spec.ts`: instantiation, getProjectSnapshot shape, getSliceSnapshot shape
- `overlay-data.adapter.spec.ts`: snapshot composition, closed milestone filtering, null milestone, slice snapshot, slice not found
- `overlay.extension.spec.ts`: 3 shortcuts registered, 3 commands registered, shared toggle, headless guard, warning on failure, custom hotkeys

### Files Changed
| File | Action |
|------|--------|
| `package.json` | Modified — added pi-tui dep |
| `src/kernel/ports/overlay-data.port.ts` | New |
| `src/kernel/ports/index.ts` | Modified — export OverlayDataPort |
| `src/cli/infrastructure/overlay-data.adapter.ts` | New |
| `src/hexagons/settings/domain/project-settings.schemas.ts` | Modified — HotkeysConfig |
| `src/hexagons/settings/domain/project-settings.builder.ts` | Modified — hotkeys field |
| `src/hexagons/settings/domain/project-settings.value-object.ts` | Modified — hotkeys getter |
| `src/hexagons/settings/index.ts` | Modified — barrel exports |
| `src/cli/overlay.extension.ts` | New |
| `src/cli/extension.ts` | Modified — DI wiring |

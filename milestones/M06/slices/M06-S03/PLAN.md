# PLAN — M06-S03: pi-tui Foundation

## Summary

Promote pi-tui to direct dep ⇒ create OverlayDataPort in kernel ⇒ add HotkeysConfig to settings ⇒ build OverlayDataAdapter ⇒ create overlay.extension.ts with toggle lifecycle ⇒ wire DI in extension.ts ⇒ verify all tests pass. Three waves — W1 is independent foundation, W2 builds adapters/extensions, W3 wires and verifies.

## Tasks

| # | Title | Files | Deps | Wave |
|---|-------|-------|------|------|
| T01 | Add pi-tui direct dependency | `package.json` | — | 1 |
| T02 | Create OverlayDataPort + snapshot types | `src/kernel/ports/overlay-data.port.ts`, `src/kernel/ports/index.ts` | — | 1 |
| T03 | Add HotkeysConfig to settings schema | `src/hexagons/settings/domain/project-settings.schemas.ts` | — | 1 |
| T04 | Create OverlayDataAdapter | `src/cli/infrastructure/overlay-data.adapter.ts` | T02 | 2 |
| T05 | Create overlay.extension.ts | `src/cli/overlay.extension.ts` | T02, T03 | 2 |
| T06 | Wire DI in extension.ts | `src/cli/extension.ts` | T04, T05 | 3 |
| T07 | Verify compilation + all tests pass | — | T06 | 3 |

## Task Details

### T01: Add pi-tui direct dependency

**Description:** Promote `@mariozechner/pi-tui` from transitive to direct dependency.
**AC:** AC1
**Files:** modify `package.json`

**Steps:**
1. Add `"@mariozechner/pi-tui": "^0.64.0"` to `dependencies` in `package.json`
2. Run `npm install` to update lockfile
3. Verify `node_modules/@mariozechner/pi-tui` resolves

### T02: Create OverlayDataPort + snapshot types

**Description:** Create abstract OverlayDataPort in kernel with OverlayProjectSnapshot and OverlaySliceSnapshot types. Export from kernel barrel.
**AC:** AC2
**Files:** new `src/kernel/ports/overlay-data.port.ts`, modify `src/kernel/ports/index.ts`

**TDD:**
- RED: Test that OverlayDataPort is importable from `@kernel` and has `getProjectSnapshot()` and `getSliceSnapshot()` methods
- GREEN: Create abstract class with Result return types, snapshot interfaces
- REFACTOR: Verify barrel exports compile

### T03: Add HotkeysConfig to settings schema

**Description:** Add HotkeysConfig sub-schema with defaults for dashboard, workflow, executionMonitor hotkeys. Add env var mappings.
**AC:** AC5
**Files:** modify `src/hexagons/settings/domain/project-settings.schemas.ts`

**TDD:**
- RED: Test that HotkeysConfigSchema parses defaults correctly and validates custom values
- GREEN: Add HotkeysConfigSchema, HOTKEYS_DEFAULTS, add to SettingsSchema, add ENV_VAR_MAP entries
- REFACTOR: Verify YAML key mapping (kebab-case → camelCase)

### T04: Create OverlayDataAdapter

**Description:** Implement OverlayDataAdapter composing ProjectRepositoryPort, MilestoneRepositoryPort, SliceRepositoryPort, TaskRepositoryPort.
**AC:** AC2
**Files:** new `src/cli/infrastructure/overlay-data.adapter.ts`

**TDD:**
- RED: Test getProjectSnapshot returns project + active milestone + slices + task counts. Test getSliceSnapshot returns slice + tasks.
- GREEN: Implement adapter composing repository reads. Filter milestones for non-closed. Aggregate task counts per slice.
- REFACTOR: None expected — straightforward composition.

### T05: Create overlay.extension.ts

**Description:** Create registerOverlayExtension() with persistent overlay toggle, hotkey registration, slash command fallbacks, 3 placeholder overlays.
**AC:** AC3, AC4, AC5, AC6, AC7, AC8, AC9
**Files:** new `src/cli/overlay.extension.ts`

**TDD:**
- RED: Test that registerOverlayExtension registers 3 shortcuts and 3 commands. Test toggle creates overlay on first call, toggles visibility on subsequent calls. Test headless guard (ctx.hasUI = false → no-op).
- GREEN: Implement toggleOverlay, registerSafe, placeholderFactory. Register dashboard/workflow/execution-monitor overlays.
- REFACTOR: Extract shared toggle state pattern if needed.

### T06: Wire DI in extension.ts

**Description:** Connect OverlayDataAdapter and registerOverlayExtension in createTffExtension().
**AC:** AC10
**Files:** modify `src/cli/extension.ts`

**Steps:**
1. Import OverlayDataAdapter, registerOverlayExtension, HOTKEYS_DEFAULTS
2. Create OverlayDataAdapter from existing repos
3. Load hotkeys from MergeSettingsUseCase (fallback to defaults)
4. Call registerOverlayExtension(api, deps)

### T07: Verify compilation + all tests pass

**Description:** Full verification — typecheck + test suite.
**AC:** AC10, AC11
**Steps:**
1. `npm run typecheck` — zero errors
2. `npm test` — all pass
3. Verify overlay registration doesn't break existing extensions

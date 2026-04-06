# M06-S05: Workflow Visualizer Overlay

## Overview

Persistent TUI overlay showing the FSM pipeline for all active (non-closed) slices in the current milestone. Provides at-a-glance visibility into where each slice sits in the `discuss → closed` pipeline and what artifacts have been produced.

**Trigger:** `ctrl+alt+w` or `/tff:workflow-view`

**Depends on:** S03 (pi-tui Foundation) — overlay infrastructure, `OverlayDataPort`, toggle pattern. No new kernel ports required.

## Approach

**Hybrid rendering** — custom-styled phase pipeline header per slice + Markdown-rendered metadata. Composed in a `Box` container. Follows the same component pattern as `DashboardComponent`.

## Component Architecture

**`WorkflowComponent`** (`src/cli/components/workflow.component.ts`)

Implements `Component` from pi-tui.

**Constructor:**
- `tui: TUI` — for triggering renders
- `overlayData: OverlayDataPort` — for querying slice data
- `markdownTheme: MarkdownTheme` — for metadata rendering
- `paddingX: number`, `paddingY: number`

No `BudgetTrackingPort` needed — this overlay shows phase state, not budget data.

**Internal structure:**
- Maintains a `Markdown` component internally (same pattern as `DashboardComponent`)
- `refresh()` queries `getProjectSnapshot()`, filters non-closed slices, builds a combined string with pipeline + metadata, sets it on the `Markdown` component, calls `tui.requestRender()`

**Rendering composition:**
The component's `render(width)` delegates to `Markdown.render(width)`. All content — including the phase pipeline — is built as a single markdown string. Pipeline phase indicators use Unicode characters (`●`, `▶`, `○`) and connectors (`──`) as plain text within the markdown. Styling (bold/dim) relies on markdown formatting (`**bold**` for current phase) rather than raw ANSI chalk calls, keeping consistency with the dashboard pattern.

**Data flow:**
```
OverlayDataPort.getProjectSnapshot()
  → filter slices where status !== "closed"
  → sort by updatedAt descending (most recent first)
  → for each slice:
      → renderPipeline(slice.status)     // custom styled string
      → renderMetadata(slice)            // markdown string
  → compose into renderable output
```

**Integration in `overlay.extension.ts`:**
- Replace workflow placeholder (current `toggleOverlay` call) with real `WorkflowComponent`
- Follow `toggleDashboard` pattern: create component inside `ctx.ui.custom()`, store handle
- Subscribe to events for auto-refresh

## Pipeline Rendering

**Phase order:**
```typescript
const PHASE_ORDER: SliceStatus[] = [
  "discussing", "researching", "planning", "executing",
  "verifying", "reviewing", "completing", "closed",
];
```

**Phase display names:**
```
discussing → discuss, researching → research, planning → plan,
executing → execute, verifying → verify, reviewing → review,
completing → ship, closed → closed
```

**Visual states (semantic intent — exact styling at implementer's discretion):**
- **Completed** (before current): filled marker, muted — `● discuss`
- **Current** (active phase): arrow marker, bold — `**▶ research**`
- **Future** (after current): empty marker, muted — `○ plan`

**Pipeline string format** (single line, connectors between phases):
```
● discuss ── ● research ── **▶ plan** ── ○ execute ── ○ verify ── ○ review ── ○ ship ── ○ closed
```

**Helper:** `renderPipeline(currentStatus: SliceStatus): string` — returns plain text with markdown bold for current phase

## Metadata Section

Rendered as Markdown below each pipeline:

```markdown
**Phase:** planning (2h 14m)
**Artifacts:** SPEC.md ✓  PLAN.md …  RESEARCH.md ✓
```

**Time in phase:** `Date.now() - slice.updatedAt` (milliseconds), formatted:
- `< 60m` (exclusive) → `Xm`
- `>= 60m` and `< 24h` → `Xh Ym`
- `>= 24h` → `Xd Yh`

**Artifact status:** derived from slice fields:
- `specPath !== null` → `SPEC.md ✓`
- `specPath === null` → `SPEC.md …`
- Same for `planPath` and `researchPath`

## Multi-Slice Layout

All non-closed slices rendered in a vertical stack, most-recently-updated first.

**Per-slice block:**
```
─── M06-S05 — Workflow Visualizer (F-lite) ───────────
● discuss ── ● research ── ▶ plan ── ○ execute ── ...
Phase: planning (2h 14m)
Artifacts: SPEC.md ✓  PLAN.md …  RESEARCH.md ✓
```

**Separator:** Horizontal rule with slice label + title + complexity tier (if classified, raw value in parentheses e.g. `(F-lite)`). Bold header line.

**Edge cases:**
- No active slices: `"All slices closed. Run /tff:status for overview."`
- Single slice: No separator, full-width
- Many slices (>4): All shown — pi-tui handles overflow scrolling
- No milestone: `"No active milestone. Run /tff:new-milestone."`

## Event Subscriptions

| Event | Trigger |
|---|---|
| `SLICE_STATUS_CHANGED` | Phase transition — pipeline visual changes |
| `SLICE_CREATED` | New slice appears in the view |
| `MILESTONE_CLOSED` | Milestone closes — triggers "no active milestone" fallback |

No throttling needed — these events are infrequent.

Wired in `overlay.extension.ts` following the dashboard pattern.

## Files Affected

| File | Action |
|---|---|
| `src/cli/components/workflow.component.ts` | **New** — WorkflowComponent + helpers |
| `src/cli/components/workflow.component.spec.ts` | **New** — Unit tests |
| `src/cli/overlay.extension.ts` | **Modify** — Replace placeholder, add event subscriptions |
| `src/cli/overlay.extension.spec.ts` | **Modify** — Update tests for workflow integration |

## Acceptance Criteria

1. **AC1: FSM pipeline rendered** — Phase pipeline shows all 8 phases (`discussing` through `closed`) with visual indicators for each active slice
2. **AC2: Phase visual distinction** — Current phase is bold+colored, completed phases are dimmed, future phases are gray/muted
3. **AC3: Phase metadata displayed** — Current phase name and time-in-phase shown below the pipeline
4. **AC4: Artifact status shown** — `SPEC.md`, `PLAN.md`, `RESEARCH.md` each show `✓` (exists) or `…` (pending) based on slice path fields
5. **AC5: All active slices visible** — Every non-closed slice in the milestone renders in a stacked layout, sorted by most-recently-updated
6. **AC6: Event-driven updates** — Overlay refreshes on `SLICE_STATUS_CHANGED`, `SLICE_CREATED`, and `MILESTONE_CLOSED` events
7. **AC7: Toggle works** — `ctrl+alt+w` and `/tff:workflow-view` both toggle visibility via the persistent `setHidden` pattern
8. **AC8: Edge cases handled** — No-active-slices and no-milestone states render meaningful fallback messages; single-slice view renders without separator
9. **AC9: No regressions** — All existing tests pass

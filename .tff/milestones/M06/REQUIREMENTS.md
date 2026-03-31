# M06: PI-Native Integration

## Goal

Deep PI SDK integration — promote `pi-ai` and `pi-tui` to direct dependencies, wire agent events from per-task sessions, build TUI overlay infrastructure with persistent dashboards.

> Full spec: `docs/superpowers/specs/2026-03-31-pi-native-integration.md`

## Architecture

**Hybrid:** Domain hexagons unchanged, PI packages in infrastructure shell. Overlay data flow: domain EventBus → OverlayDataPort query → component state → `handle.requestRender()`.

**New Ports:** `AgentEventPort`, `OverlayDataPort`

**Existing (no changes):** `ModelRoutingPort`/`ResolveModelUseCase`, `MetricsRepositoryPort`/`BudgetTrackingPort`

## Requirements

### Wave 1: Infrastructure (S01 ∥ S02 → S03)

### R01: pi-ai Direct Dependency + Type Cleanup

- Promote `@mariozechner/pi-ai` from transitive to direct dependency in package.json
- Replace `infrastructure/pi/pi.types.ts` thin aliases with direct pi-ai type imports (Model, Usage, Provider, etc.)
- All infrastructure adapters import pi-ai types directly — no indirection layer

**AC:**
- pi-ai is a direct dependency in package.json
- `pi.types.ts` deleted or reduced to re-exports only
- All existing tests pass (no domain logic changes)

### R02: Agent Event Deepening

- `AgentEventPort` interface in kernel — typed event stream: `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `PiSessionEventAdapter` implements `AgentEventPort` via `AgentSession.on()` on per-task sessions inside `PiAgentDispatchAdapter` — NOT Extension API `pi.on()` (host process only)
- Events piped to: execution journal, future TUI overlays
- `AgentResult` enriched with per-turn metrics (tokens, duration, tool invocations)
- Execution journal records richer event stream with tool call details

**Non-goal:** Migration from `createAgentSession()` to raw `pi-agent-core` `Agent` class.

**AC:**
- AgentEventPort typed for all 8 event kinds
- Events come from per-task AgentSession.on(), not host Extension API
- Journal entries include tool call details
- Existing execution tests pass + new event adapter tests

### R03: pi-tui Foundation

- Promote `@mariozechner/pi-tui` to direct dependency in package.json
- `OverlayDataPort` interface in kernel — read-only queries for milestone/slice/task/execution state
- Overlays use persistent toggle pattern: `registerShortcut` → `ctx.custom()` with `onHandle` → `handle.setHidden(true/false)` for visibility toggle
- Base rendering helpers: progress bars, phase badges, status chips using pi-tui `Text`/`Box`
- Default hotkeys: `ctrl+alt+d` (dashboard), `ctrl+alt+w` (workflow), `ctrl+alt+e` (execution monitor) — configurable via settings hexagon
- Shortcut registration handles conflicts gracefully (logs warning, falls back to slash-command-only)
- Fallback commands: `/tff:dashboard`, `/tff:workflow-view`, `/tff:execution-monitor`
- Depends on R02 (`AgentEventPort`)

**AC:**
- pi-tui is a direct dependency
- OverlayDataPort provides read-only domain state queries
- Persistent overlay toggle works (setHidden, not create-destroy)
- Hotkeys configurable, slash command fallbacks always available
- Empty placeholder renders without error for all 3 overlay slots

### Wave 2: TUI Overlays (S04-S06, depends on R03)

### R04: Status Dashboard Overlay

- Renders via `ctrl+alt+d` or `/tff:dashboard` with live data from `OverlayDataPort`
- Shows: project name, current milestone + progress bar, slice list with phase badges, task counts (done/total), budget (spent/ceiling with %), next suggested action
- Subscribes to domain EventBus; calls `handle.requestRender()` on phase transitions and task completions
- Responsive layout: adapts to terminal width (min 80 cols)
- Uses pi-tui `Markdown` for rich formatting, `Box` for sections

**AC:**
- Dashboard shows all listed data points
- Auto-refreshes on domain events
- Responsive to terminal width

### R05: Workflow Visualizer Overlay

- Renders via `ctrl+alt+w` or `/tff:workflow-view` for the active slice
- Phase pipeline: `discuss → research → plan → execute → verify → review → ship → closed`
- Current phase highlighted (bold/color), completed phases dimmed, future phases muted
- Phase metadata: time spent in phase, artifact status (SPEC.md? PLAN.md?)
- Slice selector if multiple slices active
- Subscribes to domain EventBus; calls `handle.requestRender()` on phase transitions

**AC:**
- FSM pipeline rendered with visual phase indicators
- Current/completed/future phases visually distinct
- Updates on phase transitions

### R06: Execution Monitor Overlay

- Renders via `ctrl+alt+e` or `/tff:execution-monitor` during slice execution
- Wave layout: waves 1..N with tasks grouped per wave
- Per-task: status icon (pending/running/done/failed), name, assigned model, token count, duration
- Live streaming: subscribes to `AgentEventPort` for active task agent events, throttled to 100ms render intervals
- Summary footer: total tokens, total cost, elapsed time, guardrail violations
- Subscribes to domain EventBus + `AgentEventPort`; calls `handle.requestRender()` on events

**AC:**
- Wave-grouped task display with status icons
- Live agent events streamed (throttled to 100ms)
- Summary footer with cost/token totals

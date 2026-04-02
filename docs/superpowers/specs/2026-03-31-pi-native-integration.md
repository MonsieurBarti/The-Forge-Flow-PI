# M06: PI-Native Integration

**Status**: APPROVED
**Date**: 2026-03-31
**Milestone**: M06 (inserted after M05, shifts M06-M08 → M07-M09)
**Approach**: Bottom-up integration with hybrid architecture

## Problem

TFF-PI currently has minimal PI SDK integration — only `pi-coding-agent` at 3 points (extension registration, Zod-to-JSON-Schema bridge, agent session creation). The CLI is a skeleton with no TUI, no dashboards, no overlays, no direct model control.

GSD-2 (gsd-build/gsd-2) validates the design space: same milestone/slice/task hierarchy, same lifecycle phases, deeply integrated with pi-tui dashboards, pi-ai multi-provider routing, pi-agent-core events, plus a native Rust engine. TFF-PI needs comparable PI integration to deliver a professional interactive experience while preserving its architectural strengths (hexagonal DDD, CQ integration, strict review enforcement).

## Approach

**Bottom-up**: pi-ai promotion + type cleanup → agent event wiring → pi-tui foundation → overlays.

**Hybrid architecture**: Domain hexagons remain strictly hexagonal with ports and domain events. PI packages (`pi-ai`, `pi-tui`) live in the infrastructure shell as adapter implementations. TUI overlays are read-only consumers of domain state via query ports.

**Two waves**: Wave 1 = infrastructure (S01-S03), Wave 2 = TUI overlays (S04-S06).

## Architectural Boundaries

### Unchanged (strict hexagonal domain)
- `kernel/` — DDD building blocks, Result<T,E>, ports, events
- `hexagons/workflow/` — FSM, phase transitions, session orchestration
- `hexagons/execution/` — wave dispatch, checkpoints, guardrails, overseer, metrics (cost tracking already built)
- `hexagons/review/` — merged review aggregate, verdicts
- `hexagons/slice/`, `task/`, `milestone/`, `project/` — domain models
- `hexagons/settings/` — cascading config, model profiles, budget, model routing (already built)

### PI-native (infrastructure shell)
- **Types**: Direct pi-ai type imports replace thin `pi.types.ts` aliases
- **Agent events**: `AgentSession.on()` on per-task sessions inside dispatch adapter, piped through `AgentEventPort`
- **UI**: `pi-tui` persistent overlays via `registerShortcut` + `ctx.custom()` with `onHandle`/`setHidden()` toggle pattern
- **Extension**: `createTffExtension()` composition root gains TUI overlay registration + event wiring

### Overlay Data Flow
Domain EventBus → OverlayDataPort query → overlay component state → `handle.requestRender()` → TUI re-render. Overlays are pull-based with event-driven invalidation, not push-rendered.

### New Ports
- `AgentEventPort` — stream granular agent events (turn/tool/message lifecycle) from per-task `AgentSession` instances to UI layer and journal
- `OverlayDataPort` — read-only queries for milestone/slice/task/execution state, consumed by TUI overlays

### Existing (no changes needed)
- `ModelRoutingPort` / `ResolveModelUseCase` — complexity tiers (S/F-lite/F-full), budget downshift (50%/75%), fallback chains
- Model resolution — pi-ai `getModel(provider, modelId)` already used in `PiAgentDispatchAdapter`
- Cost tracking — `AgentCostSchema`, `TaskMetricsSchema`, `AggregatedMetricsSchema`, `MetricsRepositoryPort`, `RecordTaskMetricsUseCase`, `BudgetTrackingPort` (all built in M04)

## Slices

### Wave 1: Infrastructure (S01-S03, S01 ∥ S02)

#### S01: pi-ai Direct Dependency + Type Cleanup

**Goal**: Promote pi-ai from transitive to direct dependency. Replace thin type aliases with real pi-ai types.

**Acceptance Criteria**:
1. `@mariozechner/pi-ai` promoted to direct dependency in package.json (currently transitive via pi-coding-agent)
2. Current `infrastructure/pi/pi.types.ts` thin aliases replaced with direct pi-ai type imports throughout infrastructure layer
3. All infrastructure adapters import pi-ai types directly (Model, Usage, Provider, etc.) — no indirection
4. All existing tests pass (no domain logic changes)

#### S02: Agent Event Deepening (parallel with S01)

**Goal**: Rich agent event stream from per-task AgentSession instances for UI and journal consumption.

**Acceptance Criteria**:
1. `AgentEventPort` interface in kernel — typed event stream covering: `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
2. `PiSessionEventAdapter` implements `AgentEventPort` by subscribing to `AgentSession.on()` on per-task sessions inside `PiAgentDispatchAdapter` — NOT Extension API `pi.on()` (which only covers the host process)
3. Events piped to downstream consumers (execution journal, future UI overlays)
4. `AgentResult` enriched with per-turn metrics (tokens, duration, tool invocations)
5. Execution journal records richer event stream with tool call details
6. Existing execution tests pass + new event adapter tests

**Non-goal**: Migration from `createAgentSession()` to raw `pi-agent-core` `Agent` class — stay on `AgentSession`.

#### S03: pi-tui Foundation

**Goal**: Overlay infrastructure with persistent toggle pattern, hotkey bindings, base rendering components. Depends on S02 (for `AgentEventPort`).

**Acceptance Criteria**:
1. `@mariozechner/pi-tui` promoted to direct dependency in package.json
2. `OverlayDataPort` interface in kernel — read-only queries for milestone/slice/task/execution state
3. Overlays use persistent toggle pattern: `registerShortcut` → `ctx.custom()` with `onHandle` callback → `handle.setHidden(true/false)` to toggle visibility (overlays stay alive, not create-destroy)
4. Base rendering helpers: progress bars, phase badges, status chips using pi-tui `Text`/`Box`
5. Default hotkeys: `ctrl+alt+d` (dashboard), `ctrl+alt+w` (workflow), `ctrl+alt+e` (execution monitor) — configurable via settings hexagon
6. Shortcut registration handles conflicts gracefully (logs warning, falls back to slash-command-only if shortcut already bound)
7. Fallback slash commands: `/tff:dashboard`, `/tff:workflow-view`, `/tff:execution-monitor` for environments where hotkeys conflict with OS
8. Empty placeholder content renders without error for all 3 overlay slots
9. Overlay visibility toggles work in interactive PI session

### Wave 2: TUI Overlays (S04-S06, depends on S03)

#### S04: Status Dashboard Overlay

**Goal**: At-a-glance project status visible during any agent session.

**Acceptance Criteria**:
1. Dashboard renders via `ctrl+alt+d` or `/tff:dashboard` with live data from `OverlayDataPort`
2. Shows: project name, current milestone + progress bar, slice list with phase badges, task counts (done/total), budget (spent/ceiling with %), next suggested action
3. Subscribes to domain EventBus; calls `handle.requestRender()` on phase transitions and task completions
4. Responsive layout: adapts to terminal width (min 80 cols)
5. Uses pi-tui `Markdown` for rich formatting, `Box` for sections

#### S05: Workflow Visualizer Overlay

**Goal**: Visual FSM showing where a slice is in its lifecycle.

**Acceptance Criteria**:
1. Renders via `ctrl+alt+w` or `/tff:workflow-view` for the active slice
2. Phase pipeline: `discuss → research → plan → execute → verify → review → ship → closed`
3. Current phase highlighted (bold/color), completed phases dimmed, future phases muted
4. Phase metadata: time spent in phase, artifact status (SPEC.md written? PLAN.md written?)
5. Slice selector if multiple slices active
6. Subscribes to domain EventBus; calls `handle.requestRender()` on phase transitions

#### S06: Execution Monitor Overlay

**Goal**: Real-time visibility into wave-based parallel execution.

**Acceptance Criteria**:
1. Renders via `ctrl+alt+e` or `/tff:execution-monitor` during slice execution
2. Wave layout: waves 1..N with tasks grouped per wave
3. Per-task: status icon (pending/running/done/failed), name, assigned model, token count, duration
4. Live streaming: subscribes to `AgentEventPort` for active task agent events (thinking/tool calls), throttled to 100ms render intervals
5. Summary footer: total tokens, total cost, elapsed time, guardrail violations
6. Subscribes to domain EventBus + AgentEventPort; calls `handle.requestRender()` on events

## Non-Goals

- Web UI (`pi-web-ui`) — deferred, not in scope for M06
- Native Rust engine — GSD-2's differentiator, not ours; Node.js sufficient
- Multi-provider OAuth — use existing PI provider auth, don't build custom
- GSD-2 compatibility — no interop or shared state format
- Standalone `tff` binary completion — keep as PI extension first, standalone later
- Replacing domain event bus with PI events — domain events stay internal
- Migration to raw `pi-agent-core` `Agent` class — stay on `AgentSession`
- Rebuilding model routing — settings hexagon already has `ResolveModelUseCase`
- Rebuilding cost tracking — execution hexagon already has `AgentCostSchema`, `TaskMetricsSchema`, `MetricsRepositoryPort` from M04

## Dependencies

- `@mariozechner/pi-ai@^0.64.0` (promote from transitive to direct)
- `@mariozechner/pi-tui@^0.64.0` (promote from transitive to direct)
- `@mariozechner/pi-agent-core@^0.64.0` (stays transitive via pi-coding-agent; AgentSession events accessed through pi-coding-agent re-exports)
- `@mariozechner/pi-coding-agent@^0.64.0` (existing direct dependency)

## Risks

| Risk | Mitigation |
|------|------------|
| pi-tui API instability (pre-1.0) | Pin exact versions, adapter layer isolates domain |
| Overlay performance with live execution data | Throttle AgentEventPort → render to 100ms intervals |
| OS-level hotkey conflicts (Ctrl+Alt intercepted by GNOME/KDE/macOS) | Slash command fallbacks, configurable hotkeys via settings |
| AgentSession.on() may not expose all desired event types | S02 scoped to available events; document gaps for future pi-agent-core migration |
| Persistent overlay lifecycle (onHandle/setHidden) may have edge cases | S03 documents the pattern; overlays are independent, no shared state |
| Shortcut registration collision with PI built-in bindings | Graceful fallback (AC6 in S03), verify against PI keybinding defaults |
| Scope creep into interactive commands | Strict non-goals enforcement; M06 = overlays only |

## Roadmap Impact

| Before | After |
|--------|-------|
| M05: Review & Ship | M05: Review & Ship (unchanged) |
| M06: Intelligence & Auto-Learn | **M06: PI-Native Integration** (NEW) |
| M07: Team Collaboration & Polish | M07: Intelligence & Auto-Learn |
| M08: Expansion | M08: Team Collaboration & Polish |
| — | M09: Expansion |

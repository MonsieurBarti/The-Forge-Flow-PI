# M06-S06: Execution Monitor Overlay

## Overview

Persistent TUI overlay that streams live agent output as tasks execute. Shows the current agent's message text as it arrives, plus a summary of tool calls used. Auto-tracks the most recently active task via `AgentEventPort.subscribeAll()`.

**Trigger:** `ctrl+alt+e` / `/tff:execution-monitor`

**Depends on:**
- S03 (pi-tui Foundation) — overlay infrastructure, toggle pattern
- S02 (Agent Event Deepening) — `AgentEventPort`, `AgentEvent` schema

## Goal

Replace the Execution Monitor placeholder in `overlay.extension.ts` with a live `ExecutionMonitorComponent` that subscribes to all agent events and renders streaming output.

## Scope

### In scope

- `ExecutionMonitorComponent` implementing `Component` — wraps pi-tui `Markdown` with event-driven streaming
- `subscribeAll(listener): Unsubscribe` added to `AgentEventPort` abstract class
- `InMemoryAgentEventHub.subscribeAll()` implementation + `emit()` update to notify global listeners
- Auto-tracking of most recently active task (detected from `AgentEvent.taskId`)
- Message text streaming via `message_update` textDelta accumulation
- Tool call counting (per tool name: total calls, error count)
- Three display states: executing, idle (last task output retained), no-task-yet
- Replace placeholder factory in `overlay.extension.ts` with real `ExecutionMonitorComponent`
- Pass `agentEventPort` through `OverlayExtensionDeps` and wire from `extension.ts`

### Out of scope

- Interactive controls (pause, cancel, retry)
- Scrollback history across multiple tasks
- Metrics charts or timing visualizations
- Multiple simultaneous task views
- Changes to hotkeys, commands, or overlay anchor/width settings
- Changes to `OverlayDataPort` — no task title lookup needed

## Kernel Change

One new abstract method on `AgentEventPort`:

```typescript
abstract subscribeAll(listener: AgentEventListener): Unsubscribe;
```

Implementation in `InMemoryAgentEventHub`:

```typescript
private readonly globalListeners = new Set<AgentEventListener>();

subscribeAll(listener: AgentEventListener): Unsubscribe {
  this.globalListeners.add(listener);
  return () => { this.globalListeners.delete(listener); };
}

// emit() updated to also notify global listeners after per-task listeners:
emit(taskId: string, event: AgentEvent): void {
  const set = this.listeners.get(taskId);
  if (set) {
    for (const listener of set) { listener(event); }
  }
  for (const listener of this.globalListeners) {
    listener(event);
  }
}
```

## Component Architecture

**`ExecutionMonitorComponent`** (`src/cli/components/execution-monitor.component.ts`)

Implements `Component` from pi-tui. Same structural pattern as `DashboardComponent`.

**Constructor:**
- `tui: TUI` — for triggering renders via `tui.requestRender()`
- `agentEventPort: AgentEventPort` — for `subscribeAll()`
- `markdownTheme: MarkdownTheme` — for markdown rendering
- `paddingX: number`, `paddingY: number`

**Internal state:**

```typescript
interface ExecutionMonitorState {
  activeTaskId: string | null;
  textBuffer: string;                                          // accumulated message_update deltas for current task
  toolCounts: Map<string, { total: number; errors: number }>; // per tool name
  currentTurnIndex: number;
  isExecuting: boolean;                                        // true while turn in progress
}
```

**Event handling (`handleEvent(event: AgentEvent)`):**

Dispatch order: task-switch check runs first, then type-specific dispatch on the same event.

| Event type | Action |
|---|---|
| Any event with new `taskId` (checked first) | Reset `textBuffer = ""`, `toolCounts = new Map()`, `currentTurnIndex = 0`; set `activeTaskId = event.taskId`; then continue to type-specific dispatch below |
| `turn_start` | Set `currentTurnIndex = event.turnIndex` (0-based); set `isExecuting = true` |
| `turn_end` | Set `isExecuting = false` |
| `message_update` | Append `event.textDelta` to `textBuffer` |
| `tool_execution_start` | If `toolName` not in `toolCounts`, initialize entry to `{ total: 0, errors: 0 }`; increment `toolCounts[event.toolName].total` |
| `tool_execution_end` | If `event.isError`, increment `toolCounts[event.toolName].errors` |
| Others | Ignored |

After every handled event: call `buildMarkdown()` → `markdown.setText()` → `markdown.invalidate()` → `tui.requestRender()`.

Note: `Markdown.invalidate()` clears the internal render cache (confirmed available — used identically in `DashboardComponent` and `WorkflowComponent`).

**Lifecycle:**
- `subscribeAll()` called in constructor; unsubscribe reference stored but no explicit cleanup needed (extension + process share lifetime, same pattern as dashboard)
- Component instance persists across overlay hide/show — state retained between opens

**`render(width: number)` and `invalidate()`:** delegate to internal `Markdown` component.

## Rendering Format

`buildMarkdown()` returns one of three states:

### No task yet (activeTaskId === null)

```markdown
*Waiting for execution… Run `/tff:execute` to start.*
```

### Executing (isExecuting === true)

```markdown
**Executing** — turn {currentTurnIndex + 1}

---

{textBuffer content}

---

**Tools:** Read ×3  Bash ×2  Edit ×1 (×1 err)
```

`currentTurnIndex` is 0-based (set from `event.turnIndex`); display adds 1 for human-readable turn numbering.

### Idle — last task output retained (activeTaskId set, isExecuting === false)

```markdown
**Last run** — {currentTurnIndex + 1} turns completed

---

{textBuffer content}

---

**Tools:** Read ×3  Bash ×2  Edit ×1
```

**Tool line rules:**
- Only tools with `total > 0` are shown
- Sorted by `total` descending
- Error suffix: ` (×N err)` appended if `errors > 0`
- If no tools used yet: tool line omitted entirely

## Integration in `overlay.extension.ts`

### OverlayExtensionDeps expansion

```typescript
import type { AgentEventPort } from "@kernel/ports/agent-event.port";

export interface OverlayExtensionDeps {
  overlayDataPort: OverlayDataPort;
  budgetTrackingPort: BudgetTrackingPort;
  eventBus: EventBusPort;
  agentEventPort: AgentEventPort;   // NEW
  hotkeys: HotkeysConfig;
  logger: LoggerPort;
}
```

### Replace placeholder `toggleExecMonitor`

```typescript
import { ExecutionMonitorComponent } from "./components/execution-monitor.component";

let execMonitorComponent: ExecutionMonitorComponent | undefined;

const toggleExecMonitor = async (ctx: ExtensionContext): Promise<void> => {
  if (!ctx.hasUI) return;
  if (executionMonitorHandle) {
    executionMonitorHandle.setHidden(!executionMonitorHandle.isHidden());
  } else {
    void ctx.ui.custom(
      (tui, _theme, _kb, _done) => {
        execMonitorComponent = new ExecutionMonitorComponent(
          tui,
          deps.agentEventPort,
          getMarkdownTheme(),
          2,
          1,
        );
        return execMonitorComponent;
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "80%" },
        onHandle: (h) => { executionMonitorHandle = h; },
      },
    );
  }
};
```

No EventBus subscriptions needed — the component self-manages via `subscribeAll()`.

## DI Wiring in `extension.ts`

`_agentEventHub` is created at line 99 but never connected to any dispatch adapter — events are never emitted to it (research finding U1). Two changes are required:

### 1. Create a shared dispatch adapter with the hub

```typescript
// line 99 — rename and create shared adapter:
const agentEventHub = new InMemoryAgentEventHub();
const sharedAgentDispatch = new PiAgentDispatchAdapter({ agentEventPort: agentEventHub });
```

### 2. Replace the three anonymous `PiAgentDispatchAdapter` instances

All three accept `AgentDispatchPort` (abstract) — drop-in replacement is safe:

```typescript
// piFixerAdapter (was: new PiAgentDispatchAdapter()):
const piFixerAdapter = new PiFixerAdapter(sharedAgentDispatch, templateLoader, modelResolver, logger);

// conductReviewUseCase (was: new PiAgentDispatchAdapter()):
const conductReviewUseCase = new ConductReviewUseCase(
  beadSliceSpecAdapter, gitChangedFilesAdapter, freshReviewerService,
  sharedAgentDispatch,   // ← was: new PiAgentDispatchAdapter()
  critiqueReflectionService, reviewPromptBuilder, modelResolver,
  piFixerAdapter, reviewRepository, eventBus, dateProvider, logger,
);

// verifyUseCase (was: new PiAgentDispatchAdapter()):
const verifyUseCase = new VerifyAcceptanceCriteriaUseCase(
  beadSliceSpecAdapter, freshReviewerService,
  sharedAgentDispatch,   // ← was: new PiAgentDispatchAdapter()
  piFixerAdapter, verificationRepository, new InMemoryReviewUIAdapter(),
  modelResolver, eventBus, dateProvider, () => crypto.randomUUID(), logger, templateLoader,
);
```

### 3. Pass `agentEventHub` to overlay deps

```typescript
registerOverlayExtension(api, {
  overlayDataPort: overlayDataAdapter,
  budgetTrackingPort: budgetTrackingAdapter,
  eventBus,
  agentEventPort: agentEventHub,   // NEW
  hotkeys,
  logger,
});
```

**What gets monitored:** Since `ExecuteSliceUseCase` is stubbed in M06, the monitor captures events from review agents (`/tff:ship`), fixer agents, and verification agents (`/tff:verify`) — all of which flow through `sharedAgentDispatch`.

## Files Affected

| File | Action |
|---|---|
| `src/kernel/ports/agent-event.port.ts` | **Modify** — add `abstract subscribeAll()` |
| `src/kernel/infrastructure/in-memory-agent-event-hub.ts` | **Modify** — implement `subscribeAll()`, update `emit()` |
| `src/kernel/infrastructure/in-memory-agent-event-hub.spec.ts` | **Modify** — add `subscribeAll()` tests |
| `src/cli/components/execution-monitor.component.ts` | **New** — ExecutionMonitorComponent |
| `src/cli/components/execution-monitor.component.spec.ts` | **New** — Unit tests |
| `src/cli/overlay.extension.ts` | **Modify** — add `agentEventPort` to deps, replace placeholder |
| `src/cli/extension.ts` | **Modify** — rename `_agentEventHub`, pass to overlay deps |

New files: 2 | Modified files: 5

## Acceptance Criteria

1. **AC1: subscribeAll() delivers events** — `InMemoryAgentEventHub.subscribeAll()` notifies the listener for every `emit()` call, regardless of taskId
2. **AC2: Auto task-switch** — when a new `taskId` is detected in `subscribeAll()`, `textBuffer` resets to `""`, `toolCounts` resets to an empty Map, and `currentTurnIndex` resets to `0` before processing the event
3. **AC3: Message streaming** — `message_update` textDelta values accumulate in `textBuffer`, and `textBuffer` is included as a literal substring in the string returned by `buildMarkdown()`
4. **AC4: Tool counts** — `tool_execution_start` increments `toolCounts[toolName].total`; `tool_execution_end` with `isError=true` increments `toolCounts[toolName].errors`; tool line shows only tools with `total > 0`, sorted by `total` desc, with ` (×N err)` suffix when `errors > 0`
5. **AC5: Header state** — header shows `**Executing** — turn {currentTurnIndex + 1}` while `isExecuting=true`; shows `**Last run** — {currentTurnIndex + 1} turns completed` when `isExecuting=false` and `activeTaskId !== null` (both use 1-based display; `currentTurnIndex` stores 0-based value from `event.turnIndex`)
6. **AC6: Idle state** — `buildMarkdown()` returns a string containing `*Waiting for execution…*` when `activeTaskId === null`
7. **AC7: Output persistence** — after toggling the overlay closed and re-opening it, `textBuffer`, `toolCounts`, and `currentTurnIndex` retain the values they held before closing
8. **AC8: Toggle behavior** — when `toggleExecMonitor()` is called and a handle exists, it calls `handle.setHidden(!handle.isHidden())`; hotkey (`ctrl+alt+e`) and command (`/tff:execution-monitor`) wiring verified manually
9. **AC9: No regressions** — no test file that existed before this slice fails after applying the changes in Files Affected

# M06-S06: Execution Monitor Overlay — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Replace the Execution Monitor placeholder with a live component that streams agent output via `AgentEventPort.subscribeAll()`.

**Architecture:** `ExecutionMonitorComponent` wraps pi-tui `Markdown`, subscribes to all agent events, auto-tracks the most recently active task. Kernel gets one new abstract method (`subscribeAll`). DI wiring connects `InMemoryAgentEventHub` to all `PiAgentDispatchAdapter` instances via a shared adapter.

**Tech Stack:** TypeScript, vitest, pi-tui (`Markdown`, `Component`), zod schemas

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/ports/agent-event.port.ts` | Modify | Add `abstract subscribeAll()` |
| `src/kernel/infrastructure/in-memory-agent-event-hub.ts` | Modify | Implement `subscribeAll()`, update `emit()` |
| `src/kernel/infrastructure/in-memory-agent-event-hub.spec.ts` | Modify | Add `subscribeAll` tests |
| `src/cli/components/execution-monitor.component.ts` | Create | `ExecutionMonitorComponent` + `buildMarkdown()` |
| `src/cli/components/execution-monitor.component.spec.ts` | Create | Unit tests for component + buildMarkdown |
| `src/cli/overlay.extension.ts` | Modify | Add `agentEventPort` to deps, replace placeholder |
| `src/cli/overlay.extension.spec.ts` | Modify | Add mock `agentEventPort` to all calls |
| `src/cli/extension.ts` | Modify | Shared dispatch adapter, wire hub to overlay |

---

## Wave 0

### T01: Write failing tests for `subscribeAll()`

**File:** Modify `src/kernel/infrastructure/in-memory-agent-event-hub.spec.ts`
**Traces to:** AC1

Add a new `describe("subscribeAll")` block inside the existing top-level `describe`:

```typescript
  describe("subscribeAll", () => {
    it("receives events from any taskId", () => {
      const hub = new InMemoryAgentEventHub();
      const received: AgentEvent[] = [];
      hub.subscribeAll((e) => received.push(e));

      hub.emit(TASK_A, turnStart(TASK_A));
      hub.emit(TASK_B, turnStart(TASK_B));

      expect(received).toHaveLength(2);
      expect(received[0].taskId).toBe(TASK_A);
      expect(received[1].taskId).toBe(TASK_B);
    });

    it("unsubscribe stops delivery", () => {
      const hub = new InMemoryAgentEventHub();
      const received: AgentEvent[] = [];
      const unsub = hub.subscribeAll((e) => received.push(e));

      hub.emit(TASK_A, turnStart(TASK_A));
      unsub();
      hub.emit(TASK_A, turnStart(TASK_A));

      expect(received).toHaveLength(1);
    });

    it("fires alongside per-task listeners", () => {
      const hub = new InMemoryAgentEventHub();
      const perTask: AgentEvent[] = [];
      const global: AgentEvent[] = [];
      hub.subscribe(TASK_A, (e) => perTask.push(e));
      hub.subscribeAll((e) => global.push(e));

      hub.emit(TASK_A, turnStart(TASK_A));

      expect(perTask).toHaveLength(1);
      expect(global).toHaveLength(1);
    });

    it("does not receive events after clear() for a specific task", () => {
      const hub = new InMemoryAgentEventHub();
      const received: AgentEvent[] = [];
      hub.subscribeAll((e) => received.push(e));

      hub.clear(TASK_A);
      hub.emit(TASK_A, turnStart(TASK_A));

      // subscribeAll is global — clear(taskId) only removes per-task listeners
      expect(received).toHaveLength(1);
    });
  });
```

- [ ] Add the `describe("subscribeAll")` block before the closing `});` of the top-level describe
- [ ] Run `npx vitest run src/kernel/infrastructure/in-memory-agent-event-hub.spec.ts`
- [ ] Verify FAIL — `hub.subscribeAll is not a function`

---

## Wave 1 (depends on T01)

### T02: Implement `subscribeAll()` in AgentEventPort + InMemoryAgentEventHub

**Files:** Modify `src/kernel/ports/agent-event.port.ts`, Modify `src/kernel/infrastructure/in-memory-agent-event-hub.ts`
**Traces to:** AC1

**Step 1 — Add abstract method to port:**

In `src/kernel/ports/agent-event.port.ts`, add after the `abstract clear(taskId: string): void;` line:

```typescript
  abstract subscribeAll(listener: AgentEventListener): Unsubscribe;
```

**Step 2 — Implement in hub:**

In `src/kernel/infrastructure/in-memory-agent-event-hub.ts`:

Add field after `private readonly listeners`:
```typescript
  private readonly globalListeners = new Set<AgentEventListener>();
```

Add method after `subscribe()`:
```typescript
  subscribeAll(listener: AgentEventListener): Unsubscribe {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }
```

Replace the existing `emit()` method with:
```typescript
  emit(taskId: string, event: AgentEvent): void {
    const set = this.listeners.get(taskId);
    if (set) {
      for (const listener of set) {
        listener(event);
      }
    }
    for (const listener of this.globalListeners) {
      listener(event);
    }
  }
```

- [ ] Apply edits to both files
- [ ] Run `npx vitest run src/kernel/infrastructure/in-memory-agent-event-hub.spec.ts`
- [ ] Verify PASS — all 12 tests (8 existing + 4 new)
- [ ] Commit: `feat(S06/T02): add subscribeAll to AgentEventPort and InMemoryAgentEventHub`

---

## Wave 2 (depends on T02)

### T03: Write failing tests for ExecutionMonitorComponent

**File:** Create `src/cli/components/execution-monitor.component.spec.ts`
**Traces to:** AC2, AC3, AC4, AC5, AC6

```typescript
import type { AgentEvent } from "@kernel/agents/agent-event.schema";
import type { AgentEventPort } from "@kernel/ports/agent-event.port";
import type { MarkdownTheme, TUI } from "@mariozechner/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { buildMarkdown, ExecutionMonitorComponent } from "./execution-monitor.component";
import type { ExecutionMonitorState } from "./execution-monitor.component";

const TASK_A = crypto.randomUUID();
const TASK_B = crypto.randomUUID();
const NOW = Date.now();

function identityTheme(): MarkdownTheme {
  const id = (text: string) => text;
  return {
    heading: id, link: id, linkUrl: id, code: id, codeBlock: id,
    codeBlockBorder: id, quote: id, quoteBorder: id, hr: id,
    listBullet: id, bold: id, italic: id, strikethrough: id, underline: id,
  };
}

function mockTui(): TUI & { requestRender: ReturnType<typeof vi.fn> } {
  return { requestRender: vi.fn() } as unknown as TUI & { requestRender: ReturnType<typeof vi.fn> };
}

function makeMockPort(): {
  port: AgentEventPort;
  trigger: (event: AgentEvent) => void;
} {
  let listener: ((e: AgentEvent) => void) | undefined;
  const port = {
    subscribe: vi.fn(),
    subscribeAll: vi.fn((l: (e: AgentEvent) => void) => {
      listener = l;
      return () => { listener = undefined; };
    }),
    emit: vi.fn(),
    clear: vi.fn(),
  } as unknown as AgentEventPort;
  return { port, trigger: (event) => listener?.(event) };
}

function baseState(overrides: Partial<ExecutionMonitorState> = {}): ExecutionMonitorState {
  return {
    activeTaskId: null,
    textBuffer: "",
    toolCounts: new Map(),
    currentTurnIndex: 0,
    isExecuting: false,
    ...overrides,
  };
}

// --- buildMarkdown tests ---

describe("buildMarkdown", () => {
  it("returns waiting message when no task (AC6)", () => {
    const md = buildMarkdown(baseState());
    expect(md).toContain("*Waiting for execution");
  });

  it("shows executing header with 1-based turn number (AC5)", () => {
    const md = buildMarkdown(baseState({
      activeTaskId: TASK_A,
      currentTurnIndex: 3,
      isExecuting: true,
    }));
    expect(md).toContain("**Executing** — turn 4");
  });

  it("shows last-run header when idle (AC5)", () => {
    const md = buildMarkdown(baseState({
      activeTaskId: TASK_A,
      currentTurnIndex: 2,
      isExecuting: false,
    }));
    expect(md).toContain("**Last run** — 3 turns completed");
  });

  it("includes textBuffer as literal substring (AC3)", () => {
    const text = "Analyzing the overlay structure...";
    const md = buildMarkdown(baseState({
      activeTaskId: TASK_A,
      textBuffer: text,
      isExecuting: true,
    }));
    expect(md).toContain(text);
  });

  it("shows tools sorted by total desc (AC4)", () => {
    const tools = new Map([
      ["Edit", { total: 1, errors: 0 }],
      ["Read", { total: 5, errors: 0 }],
      ["Bash", { total: 3, errors: 0 }],
    ]);
    const md = buildMarkdown(baseState({
      activeTaskId: TASK_A,
      toolCounts: tools,
      isExecuting: true,
    }));
    const toolLine = md.split("\n").find((l) => l.startsWith("**Tools:**"))!;
    const readIdx = toolLine.indexOf("Read");
    const bashIdx = toolLine.indexOf("Bash");
    const editIdx = toolLine.indexOf("Edit");
    expect(readIdx).toBeLessThan(bashIdx);
    expect(bashIdx).toBeLessThan(editIdx);
  });

  it("hides tools with total === 0 (AC4)", () => {
    const tools = new Map([
      ["Read", { total: 2, errors: 0 }],
      ["Bash", { total: 0, errors: 0 }],
    ]);
    const md = buildMarkdown(baseState({
      activeTaskId: TASK_A,
      toolCounts: tools,
      isExecuting: true,
    }));
    expect(md).toContain("Read");
    expect(md).not.toContain("Bash");
  });

  it("shows error suffix when errors > 0 (AC4)", () => {
    const tools = new Map([
      ["Read", { total: 3, errors: 1 }],
    ]);
    const md = buildMarkdown(baseState({
      activeTaskId: TASK_A,
      toolCounts: tools,
      isExecuting: true,
    }));
    expect(md).toContain("Read ×3 (×1 err)");
  });

  it("omits tool line entirely when no tools used", () => {
    const md = buildMarkdown(baseState({
      activeTaskId: TASK_A,
      isExecuting: true,
    }));
    expect(md).not.toContain("**Tools:**");
  });
});

// --- Component event handling tests ---

describe("ExecutionMonitorComponent", () => {
  it("calls subscribeAll on construction", () => {
    const { port } = makeMockPort();
    const tui = mockTui();
    new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);
    expect(port.subscribeAll).toHaveBeenCalledOnce();
  });

  it("initial render shows waiting state (AC6)", () => {
    const { port } = makeMockPort();
    const tui = mockTui();
    const comp = new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);
    const output = comp.render(80).join("\n");
    expect(output).toContain("Waiting for execution");
  });

  it("message_update accumulates in textBuffer (AC3)", () => {
    const { port, trigger } = makeMockPort();
    const tui = mockTui();
    const comp = new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);

    trigger({ type: "turn_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW });
    trigger({ type: "message_update", taskId: TASK_A, turnIndex: 0, timestamp: NOW, textDelta: "Hello " });
    trigger({ type: "message_update", taskId: TASK_A, turnIndex: 0, timestamp: NOW, textDelta: "world" });

    const output = comp.render(80).join("\n");
    expect(output).toContain("Hello world");
  });

  it("new taskId resets state (AC2)", () => {
    const { port, trigger } = makeMockPort();
    const tui = mockTui();
    const comp = new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);

    // Task A
    trigger({ type: "turn_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW });
    trigger({ type: "message_update", taskId: TASK_A, turnIndex: 0, timestamp: NOW, textDelta: "Old text" });

    // Task B — should reset
    trigger({ type: "turn_start", taskId: TASK_B, turnIndex: 0, timestamp: NOW });
    trigger({ type: "message_update", taskId: TASK_B, turnIndex: 0, timestamp: NOW, textDelta: "New text" });

    const output = comp.render(80).join("\n");
    expect(output).not.toContain("Old text");
    expect(output).toContain("New text");
  });

  it("turn_start sets executing, turn_end clears it (AC5)", () => {
    const { port, trigger } = makeMockPort();
    const tui = mockTui();
    const comp = new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);

    trigger({ type: "turn_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW });
    let output = comp.render(80).join("\n");
    expect(output).toContain("**Executing**");

    trigger({ type: "turn_end", taskId: TASK_A, turnIndex: 0, timestamp: NOW, toolCallCount: 0 });
    output = comp.render(80).join("\n");
    expect(output).toContain("**Last run**");
  });

  it("tool_execution_start increments total, initializes entry (AC4)", () => {
    const { port, trigger } = makeMockPort();
    const tui = mockTui();
    const comp = new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);

    trigger({ type: "turn_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW });
    trigger({ type: "tool_execution_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW, toolCallId: "tc1", toolName: "Read" });
    trigger({ type: "tool_execution_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW, toolCallId: "tc2", toolName: "Read" });

    const output = comp.render(80).join("\n");
    expect(output).toContain("Read ×2");
  });

  it("tool_execution_end with isError increments errors (AC4)", () => {
    const { port, trigger } = makeMockPort();
    const tui = mockTui();
    const comp = new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);

    trigger({ type: "turn_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW });
    trigger({ type: "tool_execution_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW, toolCallId: "tc1", toolName: "Bash" });
    trigger({ type: "tool_execution_end", taskId: TASK_A, turnIndex: 0, timestamp: NOW, toolCallId: "tc1", toolName: "Bash", isError: true, durationMs: 100 });

    const output = comp.render(80).join("\n");
    expect(output).toContain("Bash ×1 (×1 err)");
  });

  it("calls tui.requestRender() on every event", () => {
    const { port, trigger } = makeMockPort();
    const tui = mockTui();
    new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);

    trigger({ type: "turn_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW });
    trigger({ type: "message_update", taskId: TASK_A, turnIndex: 0, timestamp: NOW, textDelta: "hi" });

    expect(tui.requestRender).toHaveBeenCalledTimes(2);
  });

  it("invalidate() delegates without error", () => {
    const { port } = makeMockPort();
    const comp = new ExecutionMonitorComponent(mockTui(), port, identityTheme(), 2, 1);
    expect(() => comp.invalidate()).not.toThrow();
  });
});
```

- [ ] Create the spec file with the content above
- [ ] Run `npx vitest run src/cli/components/execution-monitor.component.spec.ts`
- [ ] Verify FAIL — `Cannot find module './execution-monitor.component'`

---

## Wave 3 (depends on T03)

### T04: Implement ExecutionMonitorComponent

**File:** Create `src/cli/components/execution-monitor.component.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6

```typescript
import type { AgentEvent } from "@kernel/agents/agent-event.schema";
import type { AgentEventPort, Unsubscribe } from "@kernel/ports/agent-event.port";
import type { Component, MarkdownTheme, TUI } from "@mariozechner/pi-tui";
import { Markdown } from "@mariozechner/pi-tui";

export interface ExecutionMonitorState {
  activeTaskId: string | null;
  textBuffer: string;
  toolCounts: Map<string, { total: number; errors: number }>;
  currentTurnIndex: number;
  isExecuting: boolean;
}

export function buildMarkdown(state: ExecutionMonitorState): string {
  if (state.activeTaskId === null) {
    return "*Waiting for execution… Run `/tff:execute` to start.*";
  }

  const headerLine = state.isExecuting
    ? `**Executing** — turn ${state.currentTurnIndex + 1}`
    : `**Last run** — ${state.currentTurnIndex + 1} turns completed`;

  const toolEntries = [...state.toolCounts.entries()]
    .filter(([, v]) => v.total > 0)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([name, v]) => {
      const errSuffix = v.errors > 0 ? ` (×${v.errors} err)` : "";
      return `${name} ×${v.total}${errSuffix}`;
    });

  const toolLine =
    toolEntries.length > 0 ? `**Tools:** ${toolEntries.join("  ")}` : null;

  const parts = [headerLine, "", "---", "", state.textBuffer, "", "---"];
  if (toolLine) parts.push("", toolLine);

  return parts.join("\n");
}

export class ExecutionMonitorComponent implements Component {
  private readonly markdown: Markdown;
  private readonly tui: TUI;
  private readonly _unsubscribe: Unsubscribe;

  private state: ExecutionMonitorState = {
    activeTaskId: null,
    textBuffer: "",
    toolCounts: new Map(),
    currentTurnIndex: 0,
    isExecuting: false,
  };

  constructor(
    tui: TUI,
    agentEventPort: AgentEventPort,
    markdownTheme: MarkdownTheme,
    paddingX: number,
    paddingY: number,
  ) {
    this.tui = tui;
    this.markdown = new Markdown(
      buildMarkdown(this.state),
      paddingX,
      paddingY,
      markdownTheme,
    );
    this._unsubscribe = agentEventPort.subscribeAll((event) =>
      this.handleEvent(event),
    );
  }

  private handleEvent(event: AgentEvent): void {
    if (event.taskId !== this.state.activeTaskId) {
      this.state = {
        activeTaskId: event.taskId,
        textBuffer: "",
        toolCounts: new Map(),
        currentTurnIndex: 0,
        isExecuting: false,
      };
    }

    switch (event.type) {
      case "turn_start":
        this.state.currentTurnIndex = event.turnIndex;
        this.state.isExecuting = true;
        break;
      case "turn_end":
        this.state.isExecuting = false;
        break;
      case "message_update":
        this.state.textBuffer += event.textDelta;
        break;
      case "tool_execution_start": {
        if (!this.state.toolCounts.has(event.toolName)) {
          this.state.toolCounts.set(event.toolName, { total: 0, errors: 0 });
        }
        this.state.toolCounts.get(event.toolName)!.total++;
        break;
      }
      case "tool_execution_end":
        if (event.isError) {
          const entry = this.state.toolCounts.get(event.toolName);
          if (entry) entry.errors++;
        }
        break;
    }

    this.markdown.setText(buildMarkdown(this.state));
    this.markdown.invalidate();
    this.tui.requestRender();
  }

  invalidate(): void {
    this.markdown.invalidate();
  }

  render(width: number): string[] {
    return this.markdown.render(width);
  }
}
```

- [ ] Create the component file with the content above
- [ ] Run `npx vitest run src/cli/components/execution-monitor.component.spec.ts`
- [ ] Verify PASS — all 15 tests passing
- [ ] Commit: `feat(S06/T04): implement ExecutionMonitorComponent with buildMarkdown`

---

## Wave 4 (depends on T04)

### T05: Wire ExecutionMonitorComponent into overlay extension

**Files:** Modify `src/cli/overlay.extension.ts`, Modify `src/cli/overlay.extension.spec.ts`
**Traces to:** AC7, AC8

**Step 1 — Update `overlay.extension.ts`:**

Add imports:
```typescript
import type { AgentEventPort } from "@kernel/ports/agent-event.port";
import { ExecutionMonitorComponent } from "./components/execution-monitor.component";
```

Add `agentEventPort` to `OverlayExtensionDeps`:
```typescript
export interface OverlayExtensionDeps {
  overlayDataPort: OverlayDataPort;
  budgetTrackingPort: BudgetTrackingPort;
  eventBus: EventBusPort;
  agentEventPort: AgentEventPort;
  hotkeys: HotkeysConfig;
  logger: LoggerPort;
}
```

Remove the generic `toggleOverlay` function (lines 28–51) — no longer used after this change.

Remove the `Box, Text` imports (no longer used).

Add `let execMonitorComponent` declaration near the other component variables.

Replace the execution monitor section (the `toggleExecMonitor` const and its registration) with:

```typescript
  // --- Execution Monitor ---
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
          onHandle: (h) => {
            executionMonitorHandle = h;
          },
        },
      );
    }
  };
```

**Step 2 — Update `overlay.extension.spec.ts`:**

Add import and mock helper:
```typescript
import type { AgentEventPort } from "@kernel/ports/agent-event.port";

function mockAgentEventPort(): AgentEventPort {
  return {
    subscribe: vi.fn(),
    subscribeAll: vi.fn(() => () => {}),
    emit: vi.fn(),
    clear: vi.fn(),
  } as unknown as AgentEventPort;
}
```

Add `agentEventPort: mockAgentEventPort(),` to every `registerOverlayExtension` call in the spec (7 occurrences).

- [ ] Apply edits to `overlay.extension.ts`
- [ ] Apply edits to `overlay.extension.spec.ts`
- [ ] Run `npx vitest run src/cli/overlay.extension.spec.ts`
- [ ] Verify PASS — all 8 existing tests still pass
- [ ] Run `npx vitest run src/cli/components/execution-monitor.component.spec.ts`
- [ ] Verify PASS — component tests still pass
- [ ] Commit: `feat(S06/T05): wire ExecutionMonitorComponent into overlay extension`

---

## Wave 5 (depends on T05)

### T06: Wire `agentEventHub` through shared dispatch adapter in `extension.ts`

**File:** Modify `src/cli/extension.ts`
**Traces to:** AC1, AC9

**Step 1 — Rename and create shared adapter (around line 99):**

Replace:
```typescript
const _agentEventHub = new InMemoryAgentEventHub();
```
With:
```typescript
const agentEventHub = new InMemoryAgentEventHub();
const sharedAgentDispatch = new PiAgentDispatchAdapter({ agentEventPort: agentEventHub });
```

Add import for `PiAgentDispatchAdapter` if not already imported:
```typescript
import { PiAgentDispatchAdapter } from "@hexagons/execution/infrastructure/pi-agent-dispatch.adapter";
```

**Step 2 — Replace 3 anonymous `PiAgentDispatchAdapter()` instances:**

Replace `new PiAgentDispatchAdapter()` in `PiFixerAdapter` constructor (around line 241):
```typescript
  const piFixerAdapter = new PiFixerAdapter(
    sharedAgentDispatch,
    templateLoader,
    modelResolver,
    logger,
  );
```

Replace `new PiAgentDispatchAdapter()` in `ConductReviewUseCase` constructor (around line 252):
```typescript
    sharedAgentDispatch,
```

Replace `new PiAgentDispatchAdapter()` in `VerifyAcceptanceCriteriaUseCase` constructor (around line 268):
```typescript
    sharedAgentDispatch,
```

**Step 3 — Pass `agentEventHub` to overlay deps (around line 352):**

```typescript
  registerOverlayExtension(api, {
    overlayDataPort: overlayDataAdapter,
    budgetTrackingPort,
    eventBus,
    agentEventPort: agentEventHub,
    hotkeys,
    logger,
  });
```

- [ ] Apply all edits to `extension.ts`
- [ ] Run `npx vitest run` (full test suite)
- [ ] Verify PASS — no regressions (AC9)
- [ ] Commit: `feat(S06/T06): wire agentEventHub to shared dispatch and overlay`

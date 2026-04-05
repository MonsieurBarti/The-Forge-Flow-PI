import type { AgentEvent } from "@kernel/agents/schemas/agent-event.schema";
import type { AgentEventPort } from "@kernel/ports/agent-event.port";
import type { MarkdownTheme, TUI } from "@mariozechner/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { ExecutionMonitorState } from "./execution-monitor.component";
import { buildMarkdown, ExecutionMonitorComponent } from "./execution-monitor.component";

const TASK_A = crypto.randomUUID();
const TASK_B = crypto.randomUUID();
const NOW = Date.now();

function identityTheme(): MarkdownTheme {
  const id = (text: string) => text;
  return {
    heading: id,
    link: id,
    linkUrl: id,
    code: id,
    codeBlock: id,
    codeBlockBorder: id,
    quote: id,
    quoteBorder: id,
    hr: id,
    listBullet: id,
    bold: id,
    italic: id,
    strikethrough: id,
    underline: id,
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
      return () => {
        listener = undefined;
      };
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
    const md = buildMarkdown(
      baseState({
        activeTaskId: TASK_A,
        currentTurnIndex: 3,
        isExecuting: true,
      }),
    );
    expect(md).toContain("**Executing** — turn 4");
  });

  it("shows last-run header when idle (AC5)", () => {
    const md = buildMarkdown(
      baseState({
        activeTaskId: TASK_A,
        currentTurnIndex: 2,
        isExecuting: false,
      }),
    );
    expect(md).toContain("**Last run** — 3 turns completed");
  });

  it("includes textBuffer as literal substring (AC3)", () => {
    const text = "Analyzing the overlay structure...";
    const md = buildMarkdown(
      baseState({
        activeTaskId: TASK_A,
        textBuffer: text,
        isExecuting: true,
      }),
    );
    expect(md).toContain(text);
  });

  it("shows tools sorted by total desc (AC4)", () => {
    const tools = new Map([
      ["Edit", { total: 1, errors: 0 }],
      ["Read", { total: 5, errors: 0 }],
      ["Bash", { total: 3, errors: 0 }],
    ]);
    const md = buildMarkdown(
      baseState({
        activeTaskId: TASK_A,
        toolCounts: tools,
        isExecuting: true,
      }),
    );
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
    const md = buildMarkdown(
      baseState({
        activeTaskId: TASK_A,
        toolCounts: tools,
        isExecuting: true,
      }),
    );
    expect(md).toContain("Read");
    expect(md).not.toContain("Bash");
  });

  it("shows error suffix when errors > 0 (AC4)", () => {
    const tools = new Map([["Read", { total: 3, errors: 1 }]]);
    const md = buildMarkdown(
      baseState({
        activeTaskId: TASK_A,
        toolCounts: tools,
        isExecuting: true,
      }),
    );
    expect(md).toContain("Read ×3 (×1 err)");
  });

  it("omits tool line entirely when no tools used", () => {
    const md = buildMarkdown(
      baseState({
        activeTaskId: TASK_A,
        isExecuting: true,
      }),
    );
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
    trigger({
      type: "message_update",
      taskId: TASK_A,
      turnIndex: 0,
      timestamp: NOW,
      textDelta: "Hello ",
    });
    trigger({
      type: "message_update",
      taskId: TASK_A,
      turnIndex: 0,
      timestamp: NOW,
      textDelta: "world",
    });

    const output = comp.render(80).join("\n");
    expect(output).toContain("Hello world");
  });

  it("new taskId resets state (AC2)", () => {
    const { port, trigger } = makeMockPort();
    const tui = mockTui();
    const comp = new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);

    // Task A
    trigger({ type: "turn_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW });
    trigger({
      type: "message_update",
      taskId: TASK_A,
      turnIndex: 0,
      timestamp: NOW,
      textDelta: "Old text",
    });

    // Task B — should reset
    trigger({ type: "turn_start", taskId: TASK_B, turnIndex: 0, timestamp: NOW });
    trigger({
      type: "message_update",
      taskId: TASK_B,
      turnIndex: 0,
      timestamp: NOW,
      textDelta: "New text",
    });

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
    expect(output).toContain("Executing");

    trigger({ type: "turn_end", taskId: TASK_A, turnIndex: 0, timestamp: NOW, toolCallCount: 0 });
    output = comp.render(80).join("\n");
    expect(output).toContain("Last run");
  });

  it("tool_execution_start increments total, initializes entry (AC4)", () => {
    const { port, trigger } = makeMockPort();
    const tui = mockTui();
    const comp = new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);

    trigger({ type: "turn_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW });
    trigger({
      type: "tool_execution_start",
      taskId: TASK_A,
      turnIndex: 0,
      timestamp: NOW,
      toolCallId: "tc1",
      toolName: "Read",
    });
    trigger({
      type: "tool_execution_start",
      taskId: TASK_A,
      turnIndex: 0,
      timestamp: NOW,
      toolCallId: "tc2",
      toolName: "Read",
    });

    const output = comp.render(80).join("\n");
    expect(output).toContain("Read ×2");
  });

  it("tool_execution_end with isError increments errors (AC4)", () => {
    const { port, trigger } = makeMockPort();
    const tui = mockTui();
    const comp = new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);

    trigger({ type: "turn_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW });
    trigger({
      type: "tool_execution_start",
      taskId: TASK_A,
      turnIndex: 0,
      timestamp: NOW,
      toolCallId: "tc1",
      toolName: "Bash",
    });
    trigger({
      type: "tool_execution_end",
      taskId: TASK_A,
      turnIndex: 0,
      timestamp: NOW,
      toolCallId: "tc1",
      toolName: "Bash",
      isError: true,
      durationMs: 100,
    });

    const output = comp.render(80).join("\n");
    expect(output).toContain("Bash ×1 (×1 err)");
  });

  it("calls tui.requestRender() on every event", () => {
    const { port, trigger } = makeMockPort();
    const tui = mockTui();
    new ExecutionMonitorComponent(tui, port, identityTheme(), 2, 1);

    trigger({ type: "turn_start", taskId: TASK_A, turnIndex: 0, timestamp: NOW });
    trigger({
      type: "message_update",
      taskId: TASK_A,
      turnIndex: 0,
      timestamp: NOW,
      textDelta: "hi",
    });

    expect(tui.requestRender).toHaveBeenCalledTimes(2);
  });

  it("invalidate() delegates without error", () => {
    const { port } = makeMockPort();
    const comp = new ExecutionMonitorComponent(mockTui(), port, identityTheme(), 2, 1);
    expect(() => comp.invalidate()).not.toThrow();
  });
});

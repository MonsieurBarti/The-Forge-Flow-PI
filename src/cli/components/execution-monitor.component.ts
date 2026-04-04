import type { AgentEvent } from "@kernel/agents/schemas/agent-event.schema";
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
    return "*Waiting for execution\u2026 Run `/tff:execute` to start.*";
  }

  const headerLine = state.isExecuting
    ? `**Executing** \u2014 turn ${state.currentTurnIndex + 1}`
    : `**Last run** \u2014 ${state.currentTurnIndex + 1} turns completed`;

  const toolEntries = [...state.toolCounts.entries()]
    .filter(([, v]) => v.total > 0)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([name, v]) => {
      const errSuffix = v.errors > 0 ? ` (\u00d7${v.errors} err)` : "";
      return `${name} \u00d7${v.total}${errSuffix}`;
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

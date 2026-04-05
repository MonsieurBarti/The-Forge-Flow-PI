import type { AgentEvent } from "@kernel/agents/schemas/agent-event.schema";
import type { ToolCallMetrics, TurnMetrics } from "@kernel/agents/schemas/turn-metrics.schema";

interface TurnAccumulator {
  turnIndex: number;
  startTimestamp: number;
  endTimestamp: number | null;
  toolCalls: ToolCallMetrics[];
}

export class TurnMetricsCollector {
  private readonly turns: TurnAccumulator[] = [];

  record(event: AgentEvent): void {
    switch (event.type) {
      case "turn_start":
        this.turns.push({
          turnIndex: event.turnIndex,
          startTimestamp: event.timestamp,
          endTimestamp: null,
          toolCalls: [],
        });
        break;
      case "turn_end": {
        const turn = this.findTurn(event.turnIndex);
        if (turn) turn.endTimestamp = event.timestamp;
        break;
      }
      case "tool_execution_end": {
        const turn = this.findTurn(event.turnIndex);
        if (turn) {
          turn.toolCalls.push({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            durationMs: event.durationMs,
            isError: event.isError,
          });
        }
        break;
      }
      // message_start, message_end, message_update,
      // tool_execution_start, tool_execution_update — ignored
    }
  }

  toMetrics(): TurnMetrics[] {
    return this.turns.map((t) => ({
      turnIndex: t.turnIndex,
      toolCalls: [...t.toolCalls],
      durationMs: t.endTimestamp !== null ? t.endTimestamp - t.startTimestamp : 0,
    }));
  }

  private findTurn(turnIndex: number): TurnAccumulator | undefined {
    return this.turns.find((t) => t.turnIndex === turnIndex);
  }
}

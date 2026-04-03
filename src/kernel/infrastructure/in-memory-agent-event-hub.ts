import type { AgentEvent } from "@kernel/agents/agent-event.schema";
import {
  AgentEventPort,
  type AgentEventListener,
  type Unsubscribe,
} from "@kernel/ports/agent-event.port";

export class InMemoryAgentEventHub extends AgentEventPort {
  private readonly listeners = new Map<string, Set<AgentEventListener>>();

  subscribe(taskId: string, listener: AgentEventListener): Unsubscribe {
    let set = this.listeners.get(taskId);
    if (!set) {
      set = new Set();
      this.listeners.set(taskId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  emit(taskId: string, event: AgentEvent): void {
    const set = this.listeners.get(taskId);
    if (!set) return;
    for (const listener of set) {
      listener(event);
    }
  }

  clear(taskId: string): void {
    this.listeners.delete(taskId);
  }
}

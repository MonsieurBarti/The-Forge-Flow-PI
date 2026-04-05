import type { AgentEvent } from "@kernel/agents/schemas/agent-event.schema";
import {
  type AgentEventListener,
  AgentEventPort,
  type Unsubscribe,
} from "@kernel/ports/agent-event.port";

export class InMemoryAgentEventHub extends AgentEventPort {
  private readonly listeners = new Map<string, Set<AgentEventListener>>();
  private readonly globalListeners = new Set<AgentEventListener>();

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

  subscribeAll(listener: AgentEventListener): Unsubscribe {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

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

  clear(taskId: string): void {
    this.listeners.delete(taskId);
  }
}

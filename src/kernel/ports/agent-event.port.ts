import type { AgentEvent } from "@kernel/agents/schemas/agent-event.schema";

export type AgentEventListener = (event: AgentEvent) => void;
export type Unsubscribe = () => void;

export abstract class AgentEventPort {
  abstract subscribe(taskId: string, listener: AgentEventListener): Unsubscribe;
  abstract emit(taskId: string, event: AgentEvent): void;
  abstract clear(taskId: string): void;
  abstract subscribeAll(listener: AgentEventListener): Unsubscribe;
}

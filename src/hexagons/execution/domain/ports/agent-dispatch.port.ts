import type { Result } from "@kernel";
import type { AgentDispatchConfig, AgentResult } from "@kernel/agents";
import type { AgentDispatchError } from "../errors/agent-dispatch.error";

export abstract class AgentDispatchPort {
  abstract dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>>;
  abstract abort(taskId: string): Promise<void>;
  abstract isRunning(taskId: string): boolean;
}

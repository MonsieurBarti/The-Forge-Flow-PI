import type { Result } from "@kernel";
import type { AgentDispatchError } from "../errors/agent-dispatch.error";
import type { AgentDispatchConfig } from "../schemas/agent-dispatch.schema";
import type { AgentResult } from "../schemas/agent-result.schema";

export abstract class AgentDispatchPort {
  abstract dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>>;
  abstract abort(taskId: string): Promise<void>;
  abstract isRunning(taskId: string): boolean;
}

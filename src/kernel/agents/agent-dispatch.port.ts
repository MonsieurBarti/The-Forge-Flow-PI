import type { Result } from "@kernel";
import type { AgentDispatchError } from "./agent-dispatch.error";
import type { AgentDispatchConfig } from "./agent-dispatch.schema";
import type { AgentResult } from "./agent-result.schema";

export abstract class AgentDispatchPort {
  abstract dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>>;
  abstract abort(taskId: string): Promise<void>;
  abstract isRunning(taskId: string): boolean;
}

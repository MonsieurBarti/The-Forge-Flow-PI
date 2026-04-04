import { err, ok, type Result } from "@kernel";
import {
  type AgentDispatchConfig,
  AgentDispatchError,
  AgentDispatchPort,
  type AgentResult,
  AgentResultBuilder,
} from "@kernel/agents";

interface PendingDispatch {
  resolve: (result: Result<AgentResult, AgentDispatchError>) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class InMemoryAgentDispatchAdapter extends AgentDispatchPort {
  private readonly _running = new Map<string, PendingDispatch>();
  private readonly _results = new Map<string, Result<AgentResult, AgentDispatchError>>();
  private readonly _delayed = new Map<string, number>();
  private readonly _dispatched: AgentDispatchConfig[] = [];

  givenResult(taskId: string, result: Result<AgentResult, AgentDispatchError>): void {
    this._results.set(taskId, result);
  }

  givenDelayedResult(
    taskId: string,
    result: Result<AgentResult, AgentDispatchError>,
    delayMs: number,
  ): void {
    this._results.set(taskId, result);
    this._delayed.set(taskId, delayMs);
  }

  get dispatchedConfigs(): readonly AgentDispatchConfig[] {
    return this._dispatched;
  }

  wasDispatched(taskId: string): boolean {
    return this._dispatched.some((c) => c.taskId === taskId);
  }

  async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
    this._dispatched.push(config);
    const delayMs = this._delayed.get(config.taskId);

    if (delayMs !== undefined) {
      return new Promise<Result<AgentResult, AgentDispatchError>>((resolve) => {
        const timer = setTimeout(() => {
          this._running.delete(config.taskId);
          const result =
            this._results.get(config.taskId) ??
            ok(new AgentResultBuilder().withTaskId(config.taskId).build());
          resolve(result);
        }, delayMs);
        this._running.set(config.taskId, { resolve, timer });
      });
    }

    const result =
      this._results.get(config.taskId) ??
      ok(new AgentResultBuilder().withTaskId(config.taskId).build());
    return result;
  }

  async abort(taskId: string): Promise<void> {
    const pending = this._running.get(taskId);
    if (pending) {
      if (pending.timer) clearTimeout(pending.timer);
      this._running.delete(taskId);
      pending.resolve(err(AgentDispatchError.sessionAborted(taskId)));
    }
  }

  isRunning(taskId: string): boolean {
    return this._running.has(taskId);
  }

  reset(): void {
    for (const [, pending] of this._running) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this._running.clear();
    this._results.clear();
    this._delayed.clear();
    this._dispatched.length = 0;
  }
}

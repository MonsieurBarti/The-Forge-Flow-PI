import type { OverseerContext, OverseerVerdict } from "../../../domain/overseer.schemas";
import { OverseerPort } from "../../../domain/ports/overseer.port";

interface PendingMonitor {
  resolve: (verdict: OverseerVerdict) => void;
  reject: (error: Error) => void;
}

export class InMemoryOverseerAdapter extends OverseerPort {
  private readonly pending = new Map<string, PendingMonitor>();
  private _monitorCalls: OverseerContext[] = [];

  get monitorCalls(): readonly OverseerContext[] {
    return this._monitorCalls;
  }

  async monitor(context: OverseerContext): Promise<OverseerVerdict> {
    this._monitorCalls.push(context);
    return new Promise<OverseerVerdict>((resolve, reject) => {
      this.pending.set(context.taskId, { resolve, reject });
    });
  }

  async stop(taskId: string): Promise<void> {
    const pending = this.pending.get(taskId);
    if (pending) {
      pending.reject(new Error("cancelled"));
      this.pending.delete(taskId);
    }
  }

  async stopAll(): Promise<void> {
    for (const [taskId] of this.pending) {
      await this.stop(taskId);
    }
  }

  triggerVerdict(taskId: string, verdict: OverseerVerdict): void {
    const pending = this.pending.get(taskId);
    if (pending) {
      pending.resolve(verdict);
      this.pending.delete(taskId);
    }
  }
}

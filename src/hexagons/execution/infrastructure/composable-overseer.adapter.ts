import type { OverseerContext, OverseerVerdict } from "../domain/overseer.schemas";
import type { OverseerStrategy } from "../domain/overseer-strategy";
import { OverseerPort } from "../domain/ports/overseer.port";

export class ComposableOverseerAdapter extends OverseerPort {
  private readonly activeMonitors = new Map<string, OverseerStrategy[]>();

  constructor(private readonly strategies: OverseerStrategy[]) {
    super();
  }

  async monitor(context: OverseerContext): Promise<OverseerVerdict> {
    const taskStrategies = [...this.strategies];
    this.activeMonitors.set(context.taskId, taskStrategies);

    try {
      const verdict = await Promise.race(taskStrategies.map((s) => s.start(context)));
      for (const s of taskStrategies) {
        s.cancel(context.taskId);
      }
      this.activeMonitors.delete(context.taskId);
      return verdict;
    } catch (e) {
      this.activeMonitors.delete(context.taskId);
      throw e;
    }
  }

  async stop(taskId: string): Promise<void> {
    const strategies = this.activeMonitors.get(taskId);
    if (strategies) {
      for (const s of strategies) {
        s.cancel(taskId);
      }
      this.activeMonitors.delete(taskId);
    }
  }

  async stopAll(): Promise<void> {
    for (const [taskId] of this.activeMonitors) {
      await this.stop(taskId);
    }
  }
}

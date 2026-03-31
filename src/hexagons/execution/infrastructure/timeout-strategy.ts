import type { OverseerConfig, OverseerContext, OverseerVerdict } from "../domain/overseer.schemas";
import type { OverseerStrategy } from "../domain/overseer-strategy";

export class TimeoutStrategy implements OverseerStrategy {
  readonly id = "timeout";
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly rejectors = new Map<string, (reason: Error) => void>();

  constructor(private readonly config: OverseerConfig) {}

  start(context: OverseerContext): Promise<OverseerVerdict> {
    const timeoutMs = this.config.timeouts[context.complexityTier];

    return new Promise<OverseerVerdict>((resolve, reject) => {
      this.rejectors.set(context.taskId, reject);
      const timer = setTimeout(() => {
        this.timers.delete(context.taskId);
        this.rejectors.delete(context.taskId);
        resolve({
          strategy: this.id,
          reason: `Task exceeded ${context.complexityTier} timeout of ${timeoutMs}ms`,
        });
      }, timeoutMs);
      this.timers.set(context.taskId, timer);
    });
  }

  cancel(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
    const rejector = this.rejectors.get(taskId);
    if (rejector) {
      this.rejectors.delete(taskId);
      rejector(new Error("cancelled"));
    }
  }
}

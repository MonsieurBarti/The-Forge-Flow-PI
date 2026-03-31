import type { OverseerContext, OverseerVerdict } from "./overseer.schemas";

export interface OverseerStrategy {
  readonly id: string;
  start(context: OverseerContext): Promise<OverseerVerdict>;
  cancel(taskId: string): void;
}

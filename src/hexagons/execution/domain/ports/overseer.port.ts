import type { OverseerContext, OverseerVerdict } from "../overseer.schemas";

export abstract class OverseerPort {
  abstract monitor(context: OverseerContext): Promise<OverseerVerdict>;
  abstract stop(taskId: string): Promise<void>;
  abstract stopAll(): Promise<void>;
}

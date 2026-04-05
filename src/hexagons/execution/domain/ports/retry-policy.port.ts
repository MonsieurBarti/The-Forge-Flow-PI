import type { ModelResolution } from "../fallback.schemas";
import type { RetryDecision } from "../overseer.schemas";

export abstract class RetryPolicy {
  abstract shouldRetry(taskId: string, errorCode: string, attempt: number): RetryDecision;
  abstract recordFailure(taskId: string, errorSignature: string): void;
  abstract reset(taskId: string): void;
  abstract resolveModel(taskId: string, currentProfile: string, attempt: number): ModelResolution;
}

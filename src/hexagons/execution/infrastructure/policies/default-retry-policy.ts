import type { ModelResolution } from "../../domain/fallback.schemas";
import type { RetryDecision } from "../../domain/overseer.schemas";
import { RetryPolicy } from "../../domain/ports/retry-policy.port";

export class DefaultRetryPolicy extends RetryPolicy {
  private readonly failures = new Map<string, string[]>();

  constructor(
    private readonly maxRetries: number,
    private readonly retryLoopThreshold: number,
    private readonly downshiftChain: readonly string[] = ["quality", "balanced", "budget"],
    private readonly retryCountPerProfile: number = 1,
  ) {
    super();
  }

  shouldRetry(taskId: string, _errorCode: string, attempt: number): RetryDecision {
    if (attempt >= this.maxRetries) {
      return { retry: false, reason: `max retries exhausted (${this.maxRetries})` };
    }

    const signatures = this.failures.get(taskId) ?? [];
    if (signatures.length >= this.retryLoopThreshold) {
      const lastN = signatures.slice(-this.retryLoopThreshold);
      const allIdentical = lastN.every((s) => s === lastN[0]);
      if (allIdentical) {
        return {
          retry: false,
          reason: `${this.retryLoopThreshold} identical errors detected: ${lastN[0]}`,
        };
      }
    }

    return { retry: true, reason: `attempt ${attempt + 1} of ${this.maxRetries}` };
  }

  recordFailure(taskId: string, errorSignature: string): void {
    const signatures = this.failures.get(taskId) ?? [];
    signatures.push(errorSignature);
    this.failures.set(taskId, signatures);
  }

  reset(taskId: string): void {
    this.failures.delete(taskId);
  }

  resolveModel(_taskId: string, currentProfile: string, attempt: number): ModelResolution {
    if (attempt <= this.retryCountPerProfile) {
      return { action: "retry", profile: currentProfile, attempt };
    }

    const currentIndex = this.downshiftChain.indexOf(currentProfile);
    const nextIndex = currentIndex + 1;

    if (nextIndex < this.downshiftChain.length && currentIndex >= 0) {
      return { action: "downshift", profile: this.downshiftChain[nextIndex], attempt: 0 };
    }

    return { action: "escalate", profile: currentProfile, attempt };
  }
}

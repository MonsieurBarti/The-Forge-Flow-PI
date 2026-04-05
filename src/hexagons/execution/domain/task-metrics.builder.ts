import { faker } from "@faker-js/faker";
import type { ModelProfileName } from "@kernel";
import type { TaskMetrics } from "./task-metrics.schemas";
import { TaskMetricsSchema } from "./task-metrics.schemas";

export class TaskMetricsBuilder {
  private _taskId: string = faker.string.uuid();
  private _sliceId: string = faker.string.uuid();
  private _milestoneId: string = faker.string.uuid();
  private _phase?: string;
  private _provider = "anthropic";
  private _modelId = "claude-sonnet-4-6";
  private _profile: ModelProfileName = "balanced";
  private _inputTokens: number = faker.number.int({ min: 100, max: 10000 });
  private _outputTokens: number = faker.number.int({ min: 50, max: 5000 });
  private _costUsd: number = Number.parseFloat(
    faker.finance.amount({ min: 0.001, max: 1, dec: 4 }),
  );
  private _durationMs: number = faker.number.int({ min: 1000, max: 120000 });
  private _success = true;
  private _retries = 0;
  private _downshifted = false;
  private _reflectionPassed?: boolean;
  private _reflectionTier: "fast" | "full" | "skipped" = "skipped";
  private _finalProfile?: string;
  private _totalAttempts?: number;
  private _timestamp: Date = faker.date.recent();

  withTaskId(id: string): this {
    this._taskId = id;
    return this;
  }
  withSliceId(id: string): this {
    this._sliceId = id;
    return this;
  }
  withMilestoneId(id: string): this {
    this._milestoneId = id;
    return this;
  }
  withPhase(phase: string): this {
    this._phase = phase;
    return this;
  }
  withProvider(p: string): this {
    this._provider = p;
    return this;
  }
  withModelId(id: string): this {
    this._modelId = id;
    return this;
  }
  withProfile(p: ModelProfileName): this {
    this._profile = p;
    return this;
  }
  withInputTokens(n: number): this {
    this._inputTokens = n;
    return this;
  }
  withOutputTokens(n: number): this {
    this._outputTokens = n;
    return this;
  }
  withCostUsd(c: number): this {
    this._costUsd = c;
    return this;
  }
  withDurationMs(ms: number): this {
    this._durationMs = ms;
    return this;
  }
  withSuccess(s: boolean): this {
    this._success = s;
    return this;
  }
  withRetries(r: number): this {
    this._retries = r;
    return this;
  }
  withDownshifted(d: boolean): this {
    this._downshifted = d;
    return this;
  }
  withReflectionPassed(r: boolean): this {
    this._reflectionPassed = r;
    return this;
  }
  withReflectionTier(tier: "fast" | "full" | "skipped"): this {
    this._reflectionTier = tier;
    return this;
  }
  withFinalProfile(profile: string): this {
    this._finalProfile = profile;
    return this;
  }
  withTotalAttempts(attempts: number): this {
    this._totalAttempts = attempts;
    return this;
  }
  withTimestamp(t: Date): this {
    this._timestamp = t;
    return this;
  }

  build(): TaskMetrics {
    return TaskMetricsSchema.parse({
      taskId: this._taskId,
      sliceId: this._sliceId,
      milestoneId: this._milestoneId,
      phase: this._phase,
      model: { provider: this._provider, modelId: this._modelId, profile: this._profile },
      tokens: { input: this._inputTokens, output: this._outputTokens },
      costUsd: this._costUsd,
      durationMs: this._durationMs,
      success: this._success,
      retries: this._retries,
      downshifted: this._downshifted,
      reflectionPassed: this._reflectionPassed,
      reflectionTier: this._reflectionTier,
      finalProfile: this._finalProfile,
      totalAttempts: this._totalAttempts,
      timestamp: this._timestamp,
    });
  }
}

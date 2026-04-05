import { describe, expect, it } from "vitest";
import {
  AggregatedMetricsSchema,
  ModelBreakdownEntrySchema,
  TaskMetricsModelSchema,
  TaskMetricsSchema,
} from "./task-metrics.schemas";

describe("TaskMetricsModelSchema", () => {
  const valid = { provider: "anthropic", modelId: "claude-sonnet-4-6", profile: "balanced" };
  it("parses valid model", () => {
    expect(TaskMetricsModelSchema.parse(valid)).toEqual(valid);
  });
  it("rejects empty provider", () => {
    expect(() => TaskMetricsModelSchema.parse({ ...valid, provider: "" })).toThrow();
  });
  it("rejects invalid profile", () => {
    expect(() => TaskMetricsModelSchema.parse({ ...valid, profile: "premium" })).toThrow();
  });
});

describe("TaskMetricsSchema", () => {
  const valid = {
    taskId: crypto.randomUUID(),
    sliceId: crypto.randomUUID(),
    milestoneId: crypto.randomUUID(),
    model: { provider: "anthropic", modelId: "claude-sonnet-4-6", profile: "balanced" },
    tokens: { input: 1000, output: 500 },
    costUsd: 0.05,
    durationMs: 30000,
    success: true,
    timestamp: new Date(),
  };

  it("parses valid entry", () => {
    const result = TaskMetricsSchema.parse(valid);
    expect(result.taskId).toBe(valid.taskId);
    expect(result.retries).toBe(0);
    expect(result.downshifted).toBe(false);
    expect(result.reflectionPassed).toBeUndefined();
  });

  it("defaults retries to 0", () => {
    expect(TaskMetricsSchema.parse(valid).retries).toBe(0);
  });

  it("defaults downshifted to false", () => {
    expect(TaskMetricsSchema.parse(valid).downshifted).toBe(false);
  });

  it("accepts explicit retries and downshifted", () => {
    const result = TaskMetricsSchema.parse({ ...valid, retries: 2, downshifted: true });
    expect(result.retries).toBe(2);
    expect(result.downshifted).toBe(true);
  });

  it("accepts optional reflectionPassed", () => {
    const result = TaskMetricsSchema.parse({ ...valid, reflectionPassed: true });
    expect(result.reflectionPassed).toBe(true);
  });

  it("defaults reflectionTier to skipped", () => {
    const result = TaskMetricsSchema.parse(valid);
    expect(result.reflectionTier).toBe("skipped");
  });

  it("accepts explicit reflectionTier", () => {
    const result = TaskMetricsSchema.parse({ ...valid, reflectionTier: "fast" });
    expect(result.reflectionTier).toBe("fast");
  });

  it("accepts explicit finalProfile", () => {
    const result = TaskMetricsSchema.parse({ ...valid, finalProfile: "quality" });
    expect(result.finalProfile).toBe("quality");
  });

  it("leaves finalProfile undefined when omitted", () => {
    const result = TaskMetricsSchema.parse(valid);
    expect(result.finalProfile).toBeUndefined();
  });

  it("accepts explicit totalAttempts", () => {
    const result = TaskMetricsSchema.parse({ ...valid, totalAttempts: 3 });
    expect(result.totalAttempts).toBe(3);
  });

  it("leaves totalAttempts undefined when omitted", () => {
    const result = TaskMetricsSchema.parse(valid);
    expect(result.totalAttempts).toBeUndefined();
  });

  it("rejects invalid reflectionTier", () => {
    expect(() => TaskMetricsSchema.parse({ ...valid, reflectionTier: "invalid" })).toThrow();
  });

  it("rejects negative costUsd", () => {
    expect(() => TaskMetricsSchema.parse({ ...valid, costUsd: -1 })).toThrow();
  });

  it("rejects negative tokens", () => {
    expect(() => TaskMetricsSchema.parse({ ...valid, tokens: { input: -1, output: 0 } })).toThrow();
  });

  it("rejects non-integer tokens", () => {
    expect(() =>
      TaskMetricsSchema.parse({ ...valid, tokens: { input: 1.5, output: 0 } }),
    ).toThrow();
  });

  it("rejects non-uuid taskId", () => {
    expect(() => TaskMetricsSchema.parse({ ...valid, taskId: "not-uuid" })).toThrow();
  });
});

describe("ModelBreakdownEntrySchema", () => {
  it("parses valid entry", () => {
    const result = ModelBreakdownEntrySchema.parse({
      modelId: "claude-sonnet-4-6",
      taskCount: 3,
      totalCostUsd: 0.15,
    });
    expect(result.taskCount).toBe(3);
  });
});

describe("AggregatedMetricsSchema", () => {
  const valid = {
    groupKey: { sliceId: crypto.randomUUID() },
    totalCostUsd: 1.5,
    totalInputTokens: 10000,
    totalOutputTokens: 5000,
    totalDurationMs: 300000,
    taskCount: 5,
    successCount: 4,
    failureCount: 1,
    averageCostPerTask: 0.3,
    modelBreakdown: [{ modelId: "claude-sonnet-4-6", taskCount: 5, totalCostUsd: 1.5 }],
  };

  it("parses valid aggregation", () => {
    const result = AggregatedMetricsSchema.parse(valid);
    expect(result.taskCount).toBe(5);
  });

  it("accepts empty groupKey", () => {
    const result = AggregatedMetricsSchema.parse({ ...valid, groupKey: {} });
    expect(result.groupKey.sliceId).toBeUndefined();
  });

  it("accepts milestoneId groupKey", () => {
    const result = AggregatedMetricsSchema.parse({
      ...valid,
      groupKey: { milestoneId: crypto.randomUUID() },
    });
    expect(result.groupKey.milestoneId).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";
import { TaskMetricsBuilder } from "./task-metrics.builder";
import { TaskMetricsSchema } from "./task-metrics.schemas";

describe("TaskMetricsBuilder", () => {
  it("builds valid TaskMetrics with defaults", () => {
    const metrics = new TaskMetricsBuilder().build();
    expect(TaskMetricsSchema.safeParse(metrics).success).toBe(true);
  });

  it("applies withSliceId override", () => {
    const sliceId = crypto.randomUUID();
    const metrics = new TaskMetricsBuilder().withSliceId(sliceId).build();
    expect(metrics.sliceId).toBe(sliceId);
  });

  it("applies withCostUsd override", () => {
    const metrics = new TaskMetricsBuilder().withCostUsd(1.23).build();
    expect(metrics.costUsd).toBe(1.23);
  });

  it("applies withSuccess override", () => {
    const metrics = new TaskMetricsBuilder().withSuccess(false).build();
    expect(metrics.success).toBe(false);
  });

  it("applies withModelId override", () => {
    const metrics = new TaskMetricsBuilder().withModelId("claude-opus-4-6").build();
    expect(metrics.model.modelId).toBe("claude-opus-4-6");
  });

  it("applies withMilestoneId override", () => {
    const id = crypto.randomUUID();
    const metrics = new TaskMetricsBuilder().withMilestoneId(id).build();
    expect(metrics.milestoneId).toBe(id);
  });
});

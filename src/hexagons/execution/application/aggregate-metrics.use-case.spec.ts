import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { TaskMetricsBuilder } from "../domain/task-metrics.builder";
import { InMemoryMetricsRepository } from "../infrastructure/repositories/metrics/in-memory-metrics.repository";
import { AggregateMetricsUseCase } from "./aggregate-metrics.use-case";

describe("AggregateMetricsUseCase", () => {
  const sliceId = crypto.randomUUID();
  const milestoneId = crypto.randomUUID();

  function setup(entries: ReturnType<TaskMetricsBuilder["build"]>[]) {
    const repo = new InMemoryMetricsRepository();
    repo.seed(entries);
    const useCase = new AggregateMetricsUseCase(repo);
    return { repo, useCase };
  }

  it("returns per-slice totals (AC4)", async () => {
    const entries = [
      new TaskMetricsBuilder()
        .withSliceId(sliceId)
        .withMilestoneId(milestoneId)
        .withInputTokens(1000)
        .withOutputTokens(500)
        .withCostUsd(0.05)
        .withDurationMs(10000)
        .withSuccess(true)
        .build(),
      new TaskMetricsBuilder()
        .withSliceId(sliceId)
        .withMilestoneId(milestoneId)
        .withInputTokens(2000)
        .withOutputTokens(800)
        .withCostUsd(0.08)
        .withDurationMs(20000)
        .withSuccess(true)
        .build(),
      new TaskMetricsBuilder()
        .withSliceId(sliceId)
        .withMilestoneId(milestoneId)
        .withInputTokens(500)
        .withOutputTokens(200)
        .withCostUsd(0.02)
        .withDurationMs(5000)
        .withSuccess(false)
        .build(),
    ];
    const { useCase } = setup(entries);

    const result = await useCase.aggregateBySlice(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const agg = result.data;
      expect(agg.groupKey.sliceId).toBe(sliceId);
      expect(agg.taskCount).toBe(3);
      expect(agg.successCount).toBe(2);
      expect(agg.failureCount).toBe(1);
      expect(agg.totalInputTokens).toBe(3500);
      expect(agg.totalOutputTokens).toBe(1500);
      expect(agg.totalCostUsd).toBeCloseTo(0.15);
      expect(agg.totalDurationMs).toBe(35000);
      expect(agg.averageCostPerTask).toBeCloseTo(0.05);
    }
  });

  it("returns per-milestone totals with model breakdown (AC5)", async () => {
    const entries = [
      new TaskMetricsBuilder()
        .withSliceId(sliceId)
        .withMilestoneId(milestoneId)
        .withModelId("claude-sonnet-4-6")
        .withCostUsd(0.05)
        .withSuccess(true)
        .build(),
      new TaskMetricsBuilder()
        .withSliceId(sliceId)
        .withMilestoneId(milestoneId)
        .withModelId("claude-sonnet-4-6")
        .withCostUsd(0.08)
        .withSuccess(true)
        .build(),
      new TaskMetricsBuilder()
        .withSliceId(crypto.randomUUID())
        .withMilestoneId(milestoneId)
        .withModelId("claude-opus-4-6")
        .withCostUsd(0.5)
        .withSuccess(true)
        .build(),
    ];
    const { useCase } = setup(entries);

    const result = await useCase.aggregateByMilestone(milestoneId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const agg = result.data;
      expect(agg.groupKey.milestoneId).toBe(milestoneId);
      expect(agg.taskCount).toBe(3);
      expect(agg.modelBreakdown).toHaveLength(2);

      const sonnet = agg.modelBreakdown.find((m) => m.modelId === "claude-sonnet-4-6");
      expect(sonnet).toBeDefined();
      expect(sonnet?.taskCount).toBe(2);
      expect(sonnet?.totalCostUsd).toBeCloseTo(0.13);

      const opus = agg.modelBreakdown.find((m) => m.modelId === "claude-opus-4-6");
      expect(opus).toBeDefined();
      expect(opus?.taskCount).toBe(1);
      expect(opus?.totalCostUsd).toBeCloseTo(0.5);
    }
  });

  it("returns zero aggregation for unknown slice", async () => {
    const { useCase } = setup([]);
    const result = await useCase.aggregateBySlice(crypto.randomUUID());
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.taskCount).toBe(0);
      expect(result.data.totalCostUsd).toBe(0);
      expect(result.data.modelBreakdown).toHaveLength(0);
    }
  });

  it("aggregateByPhase groups metrics by phase", async () => {
    const entries = [
      new TaskMetricsBuilder()
        .withSliceId(sliceId)
        .withMilestoneId(milestoneId)
        .withPhase("executing")
        .withCostUsd(0.05)
        .withSuccess(true)
        .build(),
      new TaskMetricsBuilder()
        .withSliceId(sliceId)
        .withMilestoneId(milestoneId)
        .withPhase("executing")
        .withCostUsd(0.08)
        .withSuccess(false)
        .build(),
      new TaskMetricsBuilder()
        .withSliceId(sliceId)
        .withMilestoneId(milestoneId)
        .withPhase("verifying")
        .withCostUsd(0.03)
        .withSuccess(true)
        .build(),
    ];
    const { useCase } = setup(entries);

    const result = await useCase.aggregateByPhase(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const byPhase = result.data;
      expect(Object.keys(byPhase)).toHaveLength(2);

      const executing = byPhase.executing;
      expect(executing).toBeDefined();
      expect(executing?.taskCount).toBe(2);
      expect(executing?.successCount).toBe(1);
      expect(executing?.failureCount).toBe(1);
      expect(executing?.totalCostUsd).toBeCloseTo(0.13);

      const verifying = byPhase.verifying;
      expect(verifying).toBeDefined();
      expect(verifying?.taskCount).toBe(1);
      expect(verifying?.successCount).toBe(1);
      expect(verifying?.totalCostUsd).toBeCloseTo(0.03);
    }
  });

  it("aggregateByPhase uses 'unknown' for entries without phase", async () => {
    const entries = [
      new TaskMetricsBuilder()
        .withSliceId(sliceId)
        .withMilestoneId(milestoneId)
        .withCostUsd(0.1)
        .build(),
    ];
    const { useCase } = setup(entries);

    const result = await useCase.aggregateByPhase(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(Object.keys(result.data)).toEqual(["unknown"]);
      expect(result.data.unknown?.taskCount).toBe(1);
    }
  });

  it("excludes entries from other slices", async () => {
    const entries = [
      new TaskMetricsBuilder().withSliceId(sliceId).withCostUsd(0.1).build(),
      new TaskMetricsBuilder().withSliceId(crypto.randomUUID()).withCostUsd(0.9).build(),
    ];
    const { useCase } = setup(entries);

    const result = await useCase.aggregateBySlice(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.taskCount).toBe(1);
      expect(result.data.totalCostUsd).toBeCloseTo(0.1);
    }
  });
});

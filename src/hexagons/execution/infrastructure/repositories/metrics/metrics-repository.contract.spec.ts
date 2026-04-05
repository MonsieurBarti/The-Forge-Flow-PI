import { isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import type { MetricsRepositoryPort } from "../../../domain/ports/metrics-repository.port";
import { TaskMetricsBuilder } from "../../../domain/task-metrics.builder";
import type { QualitySnapshot } from "../../../domain/task-metrics.schemas";

function buildQualitySnapshot(overrides: Partial<QualitySnapshot> = {}): QualitySnapshot {
  return {
    type: "quality-snapshot",
    sliceId: overrides.sliceId ?? crypto.randomUUID(),
    milestoneId: overrides.milestoneId ?? crypto.randomUUID(),
    taskId: overrides.taskId ?? crypto.randomUUID(),
    metrics: overrides.metrics ?? {
      testsPassed: 10,
      testsFailed: 0,
      lintErrors: 0,
      typeErrors: 0,
    },
    timestamp: overrides.timestamp ?? new Date(),
  };
}

export function runMetricsContractTests(
  name: string,
  factory: () => MetricsRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: MetricsRepositoryPort & { reset(): void };
    const sliceId = crypto.randomUUID();
    const milestoneId = crypto.randomUUID();

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("append + readAll round-trips (AC3)", async () => {
      const entry = new TaskMetricsBuilder()
        .withSliceId(sliceId)
        .withMilestoneId(milestoneId)
        .build();
      const appendResult = await repo.append(entry);
      expect(isOk(appendResult)).toBe(true);

      const result = await repo.readAll();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].taskId).toBe(entry.taskId);
      }
    });

    it("readBySlice filters correctly", async () => {
      const entry1 = new TaskMetricsBuilder().withSliceId(sliceId).build();
      const otherSliceId = crypto.randomUUID();
      const entry2 = new TaskMetricsBuilder().withSliceId(otherSliceId).build();
      await repo.append(entry1);
      await repo.append(entry2);

      const result = await repo.readBySlice(sliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].sliceId).toBe(sliceId);
      }
    });

    it("readByMilestone filters correctly", async () => {
      const entry1 = new TaskMetricsBuilder().withMilestoneId(milestoneId).build();
      const otherMilestoneId = crypto.randomUUID();
      const entry2 = new TaskMetricsBuilder().withMilestoneId(otherMilestoneId).build();
      await repo.append(entry1);
      await repo.append(entry2);

      const result = await repo.readByMilestone(milestoneId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].milestoneId).toBe(milestoneId);
      }
    });

    it("readAll returns empty for no entries", async () => {
      const result = await repo.readAll();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toHaveLength(0);
    });

    it("readBySlice returns empty for unknown slice", async () => {
      const result = await repo.readBySlice(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toHaveLength(0);
    });

    it("preserves all fields through round-trip", async () => {
      const entry = new TaskMetricsBuilder()
        .withRetries(2)
        .withDownshifted(true)
        .withReflectionPassed(false)
        .build();
      await repo.append(entry);

      const result = await repo.readAll();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data[0]).toMatchObject({
          retries: 2,
          downshifted: true,
          reflectionPassed: false,
        });
      }
    });

    it("quality snapshot round-trip", async () => {
      const snapshot = buildQualitySnapshot({ sliceId });
      const appendResult = await repo.append(snapshot);
      expect(isOk(appendResult)).toBe(true);

      const result = await repo.readQualitySnapshots(sliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].type).toBe("quality-snapshot");
        expect(result.data[0].sliceId).toBe(sliceId);
        expect(result.data[0].metrics.testsPassed).toBe(10);
      }
    });

    it("type discrimination: readBySlice returns only TaskMetrics, readQualitySnapshots returns only snapshots", async () => {
      const taskEntry = new TaskMetricsBuilder()
        .withSliceId(sliceId)
        .withMilestoneId(milestoneId)
        .build();
      const snapshot = buildQualitySnapshot({ sliceId, milestoneId });
      await repo.append(taskEntry);
      await repo.append(snapshot);

      const sliceResult = await repo.readBySlice(sliceId);
      expect(isOk(sliceResult)).toBe(true);
      if (isOk(sliceResult)) {
        expect(sliceResult.data).toHaveLength(1);
        expect(sliceResult.data[0].type).toBe("task-metrics");
      }

      const snapshotResult = await repo.readQualitySnapshots(sliceId);
      expect(isOk(snapshotResult)).toBe(true);
      if (isOk(snapshotResult)) {
        expect(snapshotResult.data).toHaveLength(1);
        expect(snapshotResult.data[0].type).toBe("quality-snapshot");
      }

      const allResult = await repo.readAll();
      expect(isOk(allResult)).toBe(true);
      if (isOk(allResult)) {
        expect(allResult.data).toHaveLength(2);
      }
    });

    it("readByMilestone returns only TaskMetrics (not quality snapshots)", async () => {
      const taskEntry = new TaskMetricsBuilder()
        .withMilestoneId(milestoneId)
        .withSliceId(sliceId)
        .build();
      const snapshot = buildQualitySnapshot({ milestoneId, sliceId });
      await repo.append(taskEntry);
      await repo.append(snapshot);

      const result = await repo.readByMilestone(milestoneId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].type).toBe("task-metrics");
      }
    });

    it("readQualitySnapshots filters by sliceId", async () => {
      const otherSliceId = crypto.randomUUID();
      const snapshot1 = buildQualitySnapshot({ sliceId });
      const snapshot2 = buildQualitySnapshot({ sliceId: otherSliceId });
      await repo.append(snapshot1);
      await repo.append(snapshot2);

      const result = await repo.readQualitySnapshots(sliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].sliceId).toBe(sliceId);
      }
    });

    it("readQualitySnapshots returns empty when no snapshots exist", async () => {
      const taskEntry = new TaskMetricsBuilder().withSliceId(sliceId).build();
      await repo.append(taskEntry);

      const result = await repo.readQualitySnapshots(sliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(0);
      }
    });
  });
}

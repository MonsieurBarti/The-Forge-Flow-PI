import { isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import type { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";
import { TaskMetricsBuilder } from "../domain/task-metrics.builder";

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
        expect(result.data[0].retries).toBe(2);
        expect(result.data[0].downshifted).toBe(true);
        expect(result.data[0].reflectionPassed).toBe(false);
      }
    });
  });
}

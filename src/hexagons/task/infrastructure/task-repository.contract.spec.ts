import { isErr, isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import type { TaskRepositoryPort } from "../domain/ports/task-repository.port";
import { TaskBuilder } from "../domain/task.builder";
import { InMemoryTaskRepository } from "./in-memory-task.repository";

function runContractTests(name: string, factory: () => TaskRepositoryPort & { reset(): void }) {
  describe(`${name} contract`, () => {
    let repo: TaskRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findById roundtrip", async () => {
      const task = new TaskBuilder().build();
      const saveResult = await repo.save(task);
      expect(isOk(saveResult)).toBe(true);

      const findResult = await repo.findById(task.id);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data?.id).toBe(task.id);
        expect(findResult.data?.label).toBe(task.label);
        expect(findResult.data?.title).toBe(task.title);
      }
    });

    it("save + findByLabel roundtrip", async () => {
      const task = new TaskBuilder().withLabel("T05").build();
      await repo.save(task);

      const result = await repo.findByLabel("T05");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBeNull();
        expect(result.data?.id).toBe(task.id);
      }
    });

    it("findBySliceId returns matching tasks", async () => {
      const sliceId = crypto.randomUUID();
      const t1 = new TaskBuilder().withSliceId(sliceId).withLabel("T01").build();
      const t2 = new TaskBuilder().withSliceId(sliceId).withLabel("T02").build();
      const t3 = new TaskBuilder().withLabel("T03").build();
      await repo.save(t1);
      await repo.save(t2);
      await repo.save(t3);

      const result = await repo.findBySliceId(sliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(2);
      }
    });

    it("findBySliceId returns empty array when none match", async () => {
      const result = await repo.findBySliceId(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([]);
      }
    });

    it("findById returns null for unknown id", async () => {
      const result = await repo.findById(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("findByLabel returns null for unknown label", async () => {
      const result = await repo.findByLabel("T99");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("label uniqueness: rejects duplicate label within same slice", async () => {
      const sliceId = crypto.randomUUID();
      const t1 = new TaskBuilder().withSliceId(sliceId).withLabel("T01").build();
      const t2 = new TaskBuilder().withSliceId(sliceId).withLabel("T01").build();
      await repo.save(t1);

      const result = await repo.save(t2);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("Label uniqueness");
      }
    });

    it("label uniqueness: allows same label in different slices", async () => {
      const t1 = new TaskBuilder().withSliceId(crypto.randomUUID()).withLabel("T01").build();
      const t2 = new TaskBuilder().withSliceId(crypto.randomUUID()).withLabel("T01").build();
      await repo.save(t1);

      const result = await repo.save(t2);
      expect(isOk(result)).toBe(true);
    });

    it("save allows updating an existing task", async () => {
      const task = new TaskBuilder().build();
      await repo.save(task);

      task.start(new Date());
      const result = await repo.save(task);
      expect(isOk(result)).toBe(true);
    });
  });
}

runContractTests("InMemoryTaskRepository", () => new InMemoryTaskRepository());

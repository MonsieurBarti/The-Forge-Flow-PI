import { isErr, isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { SliceBuilder } from "../domain/slice.builder";
import type { SliceRepositoryPort } from "../domain/slice-repository.port";
import { InMemorySliceRepository } from "./in-memory-slice.repository";

function runContractTests(name: string, factory: () => SliceRepositoryPort & { reset(): void }) {
  describe(`${name} contract`, () => {
    let repo: SliceRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findById roundtrip", async () => {
      const slice = new SliceBuilder().build();
      const saveResult = await repo.save(slice);
      expect(isOk(saveResult)).toBe(true);

      const findResult = await repo.findById(slice.id);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data?.id).toBe(slice.id);
        expect(findResult.data?.label).toBe(slice.label);
        expect(findResult.data?.title).toBe(slice.title);
      }
    });

    it("save + findByLabel roundtrip", async () => {
      const slice = new SliceBuilder().withLabel("M01-S05").build();
      await repo.save(slice);

      const result = await repo.findByLabel("M01-S05");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBeNull();
        expect(result.data?.id).toBe(slice.id);
      }
    });

    it("findByMilestoneId returns matching slices", async () => {
      const milestoneId = crypto.randomUUID();
      const s1 = new SliceBuilder().withMilestoneId(milestoneId).withLabel("M01-S01").build();
      const s2 = new SliceBuilder().withMilestoneId(milestoneId).withLabel("M01-S02").build();
      const s3 = new SliceBuilder().withLabel("M01-S03").build();
      await repo.save(s1);
      await repo.save(s2);
      await repo.save(s3);

      const result = await repo.findByMilestoneId(milestoneId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(2);
      }
    });

    it("findByMilestoneId returns empty array when none match", async () => {
      const result = await repo.findByMilestoneId(crypto.randomUUID());
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
      const result = await repo.findByLabel("M99-S99");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("label uniqueness: rejects duplicate label on different slice", async () => {
      const s1 = new SliceBuilder().withLabel("M01-S01").build();
      const s2 = new SliceBuilder().withLabel("M01-S01").build();
      await repo.save(s1);

      const result = await repo.save(s2);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("Label uniqueness");
      }
    });

    it("save allows updating an existing slice", async () => {
      const slice = new SliceBuilder().build();
      await repo.save(slice);

      slice.transitionTo("researching", new Date());
      const result = await repo.save(slice);
      expect(isOk(result)).toBe(true);
    });
  });
}

runContractTests("InMemorySliceRepository", () => new InMemorySliceRepository());

import { isErr, isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { MilestoneBuilder } from "../domain/milestone.builder";
import type { MilestoneRepositoryPort } from "../domain/milestone-repository.port";
import { InMemoryMilestoneRepository } from "./in-memory-milestone.repository";

function runContractTests(
  name: string,
  factory: () => MilestoneRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: MilestoneRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findById roundtrip", async () => {
      const milestone = new MilestoneBuilder().build();
      const saveResult = await repo.save(milestone);
      expect(isOk(saveResult)).toBe(true);

      const findResult = await repo.findById(milestone.id);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data?.id).toBe(milestone.id);
        expect(findResult.data?.label).toBe(milestone.label);
        expect(findResult.data?.title).toBe(milestone.title);
      }
    });

    it("save + findByLabel roundtrip", async () => {
      const milestone = new MilestoneBuilder().withLabel("M05").build();
      await repo.save(milestone);

      const result = await repo.findByLabel("M05");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBeNull();
        expect(result.data?.id).toBe(milestone.id);
      }
    });

    it("findByProjectId returns matching milestones", async () => {
      const projectId = crypto.randomUUID();
      const m1 = new MilestoneBuilder().withProjectId(projectId).withLabel("M01").build();
      const m2 = new MilestoneBuilder().withProjectId(projectId).withLabel("M02").build();
      const m3 = new MilestoneBuilder().withLabel("M03").build(); // different project
      await repo.save(m1);
      await repo.save(m2);
      await repo.save(m3);

      const result = await repo.findByProjectId(projectId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(2);
      }
    });

    it("findByProjectId returns empty array when none match", async () => {
      const result = await repo.findByProjectId(crypto.randomUUID());
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
      const result = await repo.findByLabel("M99");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("label uniqueness: rejects duplicate label on different milestone", async () => {
      const m1 = new MilestoneBuilder().withLabel("M01").build();
      const m2 = new MilestoneBuilder().withLabel("M01").build();
      await repo.save(m1);

      const result = await repo.save(m2);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("Label uniqueness");
      }
    });

    it("save allows updating an existing milestone", async () => {
      const milestone = new MilestoneBuilder().build();
      await repo.save(milestone);

      milestone.activate(new Date());
      const result = await repo.save(milestone);
      expect(isOk(result)).toBe(true);
    });
  });
}

runContractTests("InMemoryMilestoneRepository", () => new InMemoryMilestoneRepository());

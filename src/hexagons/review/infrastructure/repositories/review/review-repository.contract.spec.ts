import { isOk } from "@kernel";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { FindingBuilder } from "../../../domain/builders/finding.builder";
import { ReviewBuilder } from "../../../domain/builders/review.builder";
import type { ReviewRepositoryPort } from "../../../domain/ports/review-repository.port";
import { InMemoryReviewRepository } from "./in-memory-review.repository";
import { SqliteReviewRepository } from "./sqlite-review.repository";

function runContractTests(
  name: string,
  factory: () => ReviewRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: ReviewRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findById roundtrip", async () => {
      const review = new ReviewBuilder().build();
      const saveResult = await repo.save(review);
      expect(isOk(saveResult)).toBe(true);

      const findResult = await repo.findById(review.id);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data?.id).toBe(review.id);
        expect(findResult.data?.sliceId).toBe(review.sliceId);
        expect(findResult.data?.role).toBe(review.role);
        expect(findResult.data?.agentIdentity).toBe(review.agentIdentity);
        expect(findResult.data?.verdict).toBe(review.verdict);
      }
    });

    it("findBySliceId returns matching reviews", async () => {
      const sliceId = crypto.randomUUID();
      const r1 = new ReviewBuilder().withSliceId(sliceId).withRole("code-reviewer").build();
      const r2 = new ReviewBuilder().withSliceId(sliceId).withRole("spec-reviewer").build();
      const r3 = new ReviewBuilder().build();
      await repo.save(r1);
      await repo.save(r2);
      await repo.save(r3);

      const result = await repo.findBySliceId(sliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(2);
        const ids = result.data.map((r) => r.id);
        expect(ids).toContain(r1.id);
        expect(ids).toContain(r2.id);
      }
    });

    it("delete removes a review", async () => {
      const review = new ReviewBuilder().build();
      await repo.save(review);

      const deleteResult = await repo.delete(review.id);
      expect(isOk(deleteResult)).toBe(true);

      const findResult = await repo.findById(review.id);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).toBeNull();
      }
    });

    it("findAll returns all saved reviews", async () => {
      const r1 = new ReviewBuilder().build();
      const r2 = new ReviewBuilder().build();
      await repo.save(r1);
      await repo.save(r2);

      const result = await repo.findAll();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(2);
      }
    });

    it("reset clears all reviews", async () => {
      const r1 = new ReviewBuilder().build();
      await repo.save(r1);

      repo.reset();

      const result = await repo.findAll();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(0);
      }
    });

    it("findings array survives serialization roundtrip", async () => {
      const findings = [
        new FindingBuilder()
          .withSeverity("critical")
          .withMessage("Memory leak detected")
          .withFilePath("src/main.ts")
          .withLineStart(42)
          .withLineEnd(50)
          .withSuggestion("Use WeakRef")
          .withRuleId("no-leak")
          .withImpact("must-fix")
          .build(),
        new FindingBuilder()
          .withSeverity("info")
          .withMessage("Consider renaming")
          .withFilePath("src/utils.ts")
          .withLineStart(10)
          .build(),
      ];
      const review = new ReviewBuilder().withFindings(findings).build();
      await repo.save(review);

      const findResult = await repo.findById(review.id);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        const found = findResult.data!;
        expect(found.findings).toHaveLength(2);
        expect(found.findings[0].severity).toBe("critical");
        expect(found.findings[0].message).toBe("Memory leak detected");
        expect(found.findings[0].filePath).toBe("src/main.ts");
        expect(found.findings[0].lineStart).toBe(42);
        expect(found.findings[0].lineEnd).toBe(50);
        expect(found.findings[0].suggestion).toBe("Use WeakRef");
        expect(found.findings[0].ruleId).toBe("no-leak");
        expect(found.findings[0].impact).toBe("must-fix");
        expect(found.findings[1].severity).toBe("info");
        expect(found.findings[1].message).toBe("Consider renaming");
      }
    });

    it("findById returns null for unknown id", async () => {
      const result = await repo.findById(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("findBySliceId returns empty array when none match", async () => {
      const result = await repo.findBySliceId(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([]);
      }
    });
  });
}

runContractTests("InMemoryReviewRepository", () => new InMemoryReviewRepository());

runContractTests("SqliteReviewRepository", () => {
  const db = new Database(":memory:");
  return new SqliteReviewRepository(db);
});

import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { Review } from "../aggregates/review.aggregate";
import { FindingBuilder } from "../builders/finding.builder";
import { ReviewBuilder } from "../builders/review.builder";
import { MergedReview } from "./merged-review.vo";

const sliceId = faker.string.uuid();
const now = new Date();

describe("MergedReview", () => {
  describe("merge", () => {
    it("deduplicates findings by filePath+lineStart, highest severity wins (AC7)", () => {
      const r1 = new ReviewBuilder()
        .withSliceId(sliceId)
        .withFindings([
          new FindingBuilder()
            .withFilePath("src/a.ts")
            .withLineStart(10)
            .withSeverity("medium")
            .build(),
        ])
        .build();
      const r2 = new ReviewBuilder()
        .withSliceId(sliceId)
        .withFindings([
          new FindingBuilder()
            .withFilePath("src/a.ts")
            .withLineStart(10)
            .withSeverity("critical")
            .build(),
        ])
        .build();
      const result = MergedReview.merge([r1, r2], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.findings).toHaveLength(1);
      expect(result.data.findings[0].severity).toBe("critical");
      expect(result.data.findings[0].sourceReviewIds).toHaveLength(2);
    });

    it("detects conflicts when severity diff >= 2 levels (AC8)", () => {
      const r1 = new ReviewBuilder()
        .withSliceId(sliceId)
        .withFindings([
          new FindingBuilder()
            .withFilePath("src/a.ts")
            .withLineStart(5)
            .withSeverity("critical")
            .build(),
        ])
        .build();
      const r2 = new ReviewBuilder()
        .withSliceId(sliceId)
        .withFindings([
          new FindingBuilder()
            .withFilePath("src/a.ts")
            .withLineStart(5)
            .withSeverity("low")
            .build(),
        ])
        .build();
      const result = MergedReview.merge([r1, r2], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.conflicts.length).toBeGreaterThan(0);
    });

    it("approved + changes_requested → changes_requested (AC9)", () => {
      const r1 = new ReviewBuilder().withSliceId(sliceId).build();
      const r2 = new ReviewBuilder()
        .withSliceId(sliceId)
        .withFindings([new FindingBuilder().withSeverity("critical").build()])
        .build();
      const result = MergedReview.merge([r1, r2], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.verdict).toBe("changes_requested");
    });

    it("approved + rejected → rejected (AC10)", () => {
      const r1 = new ReviewBuilder().withSliceId(sliceId).build();
      const r2reconProps = {
        id: faker.string.uuid(),
        sliceId,
        role: "tff-code-reviewer" as const,
        agentIdentity: "agent-2",
        verdict: "rejected" as const,
        findings: [],
        createdAt: now,
        updatedAt: now,
      };
      const r2 = Review.reconstitute(r2reconProps);
      const result = MergedReview.merge([r1, r2], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.verdict).toBe("rejected");
    });

    it("approved + approved → approved (AC11)", () => {
      const r1 = new ReviewBuilder().withSliceId(sliceId).build();
      const r2 = new ReviewBuilder().withSliceId(sliceId).build();
      const result = MergedReview.merge([r1, r2], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.verdict).toBe("approved");
    });

    it("empty array → error (AC12)", () => {
      const result = MergedReview.merge([], now);
      expect(result.ok).toBe(false);
    });

    it("mismatched sliceId → error (AC13)", () => {
      const r1 = new ReviewBuilder().withSliceId(faker.string.uuid()).build();
      const r2 = new ReviewBuilder().withSliceId(faker.string.uuid()).build();
      const result = MergedReview.merge([r1, r2], now);
      expect(result.ok).toBe(false);
    });

    it("hasBlockers and hasConflicts (AC14)", () => {
      const r1 = new ReviewBuilder()
        .withSliceId(sliceId)
        .withFindings([new FindingBuilder().withSeverity("critical").build()])
        .build();
      const result = MergedReview.merge([r1], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.hasBlockers()).toBe(true);
      expect(result.data.hasConflicts()).toBe(false);
    });
  });
});

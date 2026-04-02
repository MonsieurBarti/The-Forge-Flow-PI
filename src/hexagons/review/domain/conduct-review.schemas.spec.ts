import { describe, expect, it } from "vitest";
import { ConductReviewRequestSchema, ConductReviewResultSchema } from "./conduct-review.schemas";

describe("ConductReviewRequestSchema", () => {
  it("accepts valid request with defaults", () => {
    const result = ConductReviewRequestSchema.parse({
      sliceId: "550e8400-e29b-41d4-a716-446655440000",
      workingDirectory: "/tmp/work",
    });
    expect(result.timeoutMs).toBe(300_000);
    expect(result.maxFixCycles).toBe(2);
  });

  it("accepts explicit timeoutMs and maxFixCycles", () => {
    const result = ConductReviewRequestSchema.parse({
      sliceId: "550e8400-e29b-41d4-a716-446655440000",
      workingDirectory: "/tmp/work",
      timeoutMs: 60_000,
      maxFixCycles: 0,
    });
    expect(result.timeoutMs).toBe(60_000);
    expect(result.maxFixCycles).toBe(0);
  });

  it("rejects empty workingDirectory", () => {
    expect(() =>
      ConductReviewRequestSchema.parse({
        sliceId: "550e8400-e29b-41d4-a716-446655440000",
        workingDirectory: "",
      }),
    ).toThrow();
  });

  it("rejects negative timeoutMs", () => {
    expect(() =>
      ConductReviewRequestSchema.parse({
        sliceId: "550e8400-e29b-41d4-a716-446655440000",
        workingDirectory: "/tmp",
        timeoutMs: -1,
      }),
    ).toThrow();
  });
});

describe("ConductReviewResultSchema", () => {
  it("accepts valid result", () => {
    const now = new Date().toISOString();
    const result = ConductReviewResultSchema.parse({
      mergedReview: {
        sliceId: "550e8400-e29b-41d4-a716-446655440000",
        sourceReviewIds: ["550e8400-e29b-41d4-a716-446655440001"],
        verdict: "approved",
        findings: [],
        conflicts: [],
        mergedAt: now,
      },
      individualReviews: [],
      fixCyclesUsed: 0,
      timedOutReviewers: [],
      retriedReviewers: [],
    });
    expect(result.fixCyclesUsed).toBe(0);
  });

  it("rejects negative fixCyclesUsed", () => {
    expect(() =>
      ConductReviewResultSchema.parse({
        mergedReview: {
          sliceId: "550e8400-e29b-41d4-a716-446655440000",
          sourceReviewIds: ["550e8400-e29b-41d4-a716-446655440001"],
          verdict: "approved",
          findings: [],
          conflicts: [],
          mergedAt: new Date().toISOString(),
        },
        individualReviews: [],
        fixCyclesUsed: -1,
        timedOutReviewers: [],
        retriedReviewers: [],
      }),
    ).toThrow();
  });
});

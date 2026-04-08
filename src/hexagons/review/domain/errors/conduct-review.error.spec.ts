import { describe, expect, it } from "vitest";
import { ConductReviewError } from "./conduct-review.error";

describe("ConductReviewError", () => {
  it("contextResolutionFailed has correct code and metadata", () => {
    const error = ConductReviewError.contextResolutionFailed(
      "slice-1",
      new Error("spec not found"),
    );
    expect(error.code).toBe("REVIEW.CONTEXT_RESOLUTION_FAILED");
    expect(error.message).toContain("slice-1");
    expect(error.message).toContain("spec not found");
    expect(error.metadata?.sliceId).toBe("slice-1");
  });

  it("allReviewersFailed has correct code and metadata", () => {
    const failures = [{ role: "tff-code-reviewer", cause: "timeout" }];
    const error = ConductReviewError.allReviewersFailed("slice-1", failures);
    expect(error.code).toBe("REVIEW.ALL_REVIEWERS_FAILED");
    expect(error.metadata?.sliceId).toBe("slice-1");
    expect(error.metadata?.failures).toEqual(failures);
  });

  it("reviewerRetryExhausted has correct code and metadata", () => {
    const error = ConductReviewError.reviewerRetryExhausted(
      "slice-1",
      "tff-code-reviewer",
      new Error("timeout"),
    );
    expect(error.code).toBe("REVIEW.REVIEWER_RETRY_EXHAUSTED");
    expect(error.metadata?.role).toBe("tff-code-reviewer");
  });

  it("freshReviewerBlocked has correct code and metadata", () => {
    const error = ConductReviewError.freshReviewerBlocked(
      "slice-1",
      "tff-code-reviewer",
      "agent-42",
    );
    expect(error.code).toBe("REVIEW.FRESH_REVIEWER_BLOCKED");
    expect(error.metadata?.reviewerId).toBe("agent-42");
  });

  it("mergeError has correct code and metadata", () => {
    const error = ConductReviewError.mergeError("slice-1", new Error("merge failed"));
    expect(error.code).toBe("REVIEW.MERGE_FAILED");
    expect(error.metadata?.sliceId).toBe("slice-1");
  });

  it("all errors extend Error", () => {
    const error = ConductReviewError.contextResolutionFailed("s", "boom");
    expect(error).toBeInstanceOf(Error);
  });
});

import { describe, expect, it } from "vitest";
import { ReviewUIError } from "./review-ui.error";

describe("ReviewUIError", () => {
  it("presentationFailed has correct code and metadata", () => {
    const error = ReviewUIError.presentationFailed("presentFindings", new Error("crash"));
    expect(error.code).toBe("REVIEW_UI.PRESENTATION_FAILED");
    expect(error.message).toContain("presentFindings");
    expect(error.message).toContain("crash");
    expect(error.metadata?.context).toBe("presentFindings");
  });

  it("plannotatorNotFound has correct code", () => {
    const error = ReviewUIError.plannotatorNotFound();
    expect(error.code).toBe("REVIEW_UI.PLANNOTATOR_NOT_FOUND");
    expect(error.message).toContain("plannotator");
  });

  it("feedbackParseError has correct code and raw content", () => {
    const error = ReviewUIError.feedbackParseError("garbled output");
    expect(error.code).toBe("REVIEW_UI.FEEDBACK_PARSE_ERROR");
    expect(error.metadata?.raw).toBe("garbled output");
  });

  it("all errors extend Error", () => {
    const error = ReviewUIError.presentationFailed("ctx", "boom");
    expect(error).toBeInstanceOf(Error);
  });
});

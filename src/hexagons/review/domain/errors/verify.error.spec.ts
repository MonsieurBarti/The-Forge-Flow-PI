import { describe, expect, it } from "vitest";
import { VerifyError } from "./verify.error";

describe("VerifyError", () => {
  it("contextResolutionFailed", () => {
    const e = VerifyError.contextResolutionFailed("slice-1", new Error("boom"));
    expect(e.code).toBe("VERIFY.CONTEXT_RESOLUTION_FAILED");
    expect(e.message).toContain("slice-1");
    expect(e.message).toContain("boom");
  });

  it("freshReviewerBlocked", () => {
    const e = VerifyError.freshReviewerBlocked("slice-1", "verifier-abc");
    expect(e.code).toBe("VERIFY.FRESH_REVIEWER_BLOCKED");
    expect(e.message).toContain("verifier-abc");
  });

  it("verifierFailed", () => {
    const e = VerifyError.verifierFailed("slice-1", new Error("timeout"));
    expect(e.code).toBe("VERIFY.VERIFIER_FAILED");
  });

  it("parseError", () => {
    const e = VerifyError.parseError("slice-1", "garbage");
    expect(e.code).toBe("VERIFY.PARSE_ERROR");
    expect(e.message).toContain("slice-1");
  });
});

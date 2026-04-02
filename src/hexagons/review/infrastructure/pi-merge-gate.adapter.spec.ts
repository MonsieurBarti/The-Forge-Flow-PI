import { describe, expect, it } from "vitest";
import { buildMergeGateOptions, buildMergeGateQuestionText } from "./pi-merge-gate.adapter";

describe("buildMergeGateOptions", () => {
  it("returns 3 options mapping to decision values", () => {
    const options = buildMergeGateOptions();
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.value)).toEqual(["merged", "needs_changes", "abort"]);
  });
});

describe("buildMergeGateQuestionText", () => {
  it("includes prUrl", () => {
    const text = buildMergeGateQuestionText({
      sliceId: "s1",
      prUrl: "https://url",
      prNumber: 42,
      cycle: 0,
    });
    expect(text).toContain("https://url");
  });

  it("includes lastError when present", () => {
    const text = buildMergeGateQuestionText({
      sliceId: "s1",
      prUrl: "https://url",
      prNumber: 42,
      cycle: 1,
      lastError: "push failed: auth error",
    });
    expect(text).toContain("push failed: auth error");
  });
});

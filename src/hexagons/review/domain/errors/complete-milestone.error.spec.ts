import { describe, expect, it } from "vitest";
import { CompleteMilestoneError } from "./complete-milestone.error";

describe("CompleteMilestoneError", () => {
  it("mergeBackFailed", () => {
    const e = CompleteMilestoneError.mergeBackFailed("M07", new Error("sync failed"));
    expect(e.code).toBe("MILESTONE.MERGE_BACK_FAILED");
    expect(e.message).toContain("M07");
    expect(e.message).toContain("sync failed");
  });
});

import { describe, expect, it } from "vitest";
import { RenameDetectionResultSchema } from "./rename-detection.schemas";

describe("RenameDetectionResultSchema", () => {
  it("parses match variant", () => {
    const result = RenameDetectionResultSchema.safeParse({ kind: "match" });
    expect(result.success).toBe(true);
  });

  it("parses switch variant", () => {
    const result = RenameDetectionResultSchema.safeParse({ kind: "switch" });
    expect(result.success).toBe(true);
  });

  it("parses rename variant with newBranch", () => {
    const result = RenameDetectionResultSchema.safeParse({
      kind: "rename",
      newBranch: "feature/new-name",
    });
    expect(result.success).toBe(true);
  });

  it("parses untracked variant", () => {
    const result = RenameDetectionResultSchema.safeParse({ kind: "untracked" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown kind", () => {
    const result = RenameDetectionResultSchema.safeParse({ kind: "unknown" });
    expect(result.success).toBe(false);
  });

  it("rejects rename without newBranch", () => {
    const result = RenameDetectionResultSchema.safeParse({ kind: "rename" });
    expect(result.success).toBe(false);
  });
});

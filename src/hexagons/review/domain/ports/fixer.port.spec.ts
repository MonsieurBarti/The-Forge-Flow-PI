import { describe, expect, it } from "vitest";
import { FixResultSchema } from "./fixer.port";

describe("FixResultSchema", () => {
  it("parses result with justifications", () => {
    const result = FixResultSchema.parse({
      fixed: [],
      deferred: [],
      justifications: { "finding-1": "Not a real issue — false positive" },
      testsPassing: true,
    });
    expect(result.justifications).toEqual({ "finding-1": "Not a real issue — false positive" });
  });

  it("defaults justifications to empty object when omitted", () => {
    const result = FixResultSchema.parse({
      fixed: [],
      deferred: [],
      testsPassing: true,
    });
    expect(result.justifications).toEqual({});
  });

  it("preserves existing fixed/deferred/testsPassing fields", () => {
    const finding = {
      id: "a1b2c3d4-e5f6-4789-8abc-def012345678",
      severity: "high",
      message: "Issue found",
      filePath: "src/foo.ts",
      lineStart: 10,
    };
    const result = FixResultSchema.parse({
      fixed: [finding],
      deferred: [finding],
      testsPassing: false,
    });
    expect(result.fixed).toHaveLength(1);
    expect(result.deferred).toHaveLength(1);
    expect(result.testsPassing).toBe(false);
    expect(result.justifications).toEqual({});
  });
});

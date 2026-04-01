import { describe, expect, it } from "vitest";
import { FixRequestSchema, FixResultSchema } from "./fixer.port";
import { SliceSpecSchema } from "./slice-spec.port";

describe("SliceSpecSchema", () => {
  it("accepts valid spec", () => {
    const valid = {
      sliceId: "slice-1",
      sliceLabel: "M05-S04",
      sliceTitle: "Multi-stage review",
      specContent: "# Spec content",
      acceptanceCriteria: "## AC\n- AC1: ...",
    };
    expect(SliceSpecSchema.parse(valid)).toEqual(valid);
  });

  it("rejects empty sliceId", () => {
    expect(() =>
      SliceSpecSchema.parse({
        sliceId: "",
        sliceLabel: "X",
        sliceTitle: "X",
        specContent: "X",
        acceptanceCriteria: "X",
      }),
    ).toThrow();
  });
});

describe("FixRequestSchema", () => {
  it("accepts valid request", () => {
    const valid = {
      sliceId: "slice-1",
      findings: [],
      workingDirectory: "/tmp/work",
    };
    expect(FixRequestSchema.parse(valid)).toEqual(valid);
  });

  it("rejects empty workingDirectory", () => {
    expect(() =>
      FixRequestSchema.parse({ sliceId: "s", findings: [], workingDirectory: "" }),
    ).toThrow();
  });
});

describe("FixResultSchema", () => {
  it("accepts valid result", () => {
    const valid = { fixed: [], deferred: [], testsPassing: true };
    expect(FixResultSchema.parse(valid)).toEqual(valid);
  });

  it("rejects missing testsPassing", () => {
    expect(() => FixResultSchema.parse({ fixed: [], deferred: [] })).toThrow();
  });
});

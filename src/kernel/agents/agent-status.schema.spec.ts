import { describe, expect, it } from "vitest";
import {
  AgentConcernSchema,
  AgentStatusReportSchema,
  AgentStatusSchema,
  isSuccessfulStatus,
  SelfReviewChecklistSchema,
} from "./agent-status.schema";

const ALL_PASSED_DIMS = [
  { dimension: "completeness" as const, passed: true },
  { dimension: "quality" as const, passed: true },
  { dimension: "discipline" as const, passed: true },
  { dimension: "verification" as const, passed: true },
];

describe("AgentStatusSchema", () => {
  it("accepts all four valid statuses", () => {
    for (const s of ["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"]) {
      expect(AgentStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid status", () => {
    expect(() => AgentStatusSchema.parse("SUCCESS")).toThrow();
  });
});

describe("AgentConcernSchema", () => {
  it("parses valid concern", () => {
    const concern = AgentConcernSchema.parse({
      area: "test coverage",
      description: "Missing edge case tests",
      severity: "warning",
    });
    expect(concern.area).toBe("test coverage");
  });

  it("rejects empty area", () => {
    expect(() =>
      AgentConcernSchema.parse({ area: "", description: "x", severity: "info" }),
    ).toThrow();
  });

  it("rejects invalid severity", () => {
    expect(() =>
      AgentConcernSchema.parse({ area: "x", description: "y", severity: "fatal" }),
    ).toThrow();
  });
});

describe("SelfReviewChecklistSchema", () => {
  it("parses valid 4-dimension checklist", () => {
    const checklist = SelfReviewChecklistSchema.parse({
      dimensions: ALL_PASSED_DIMS,
      overallConfidence: "high",
    });
    expect(checklist.dimensions).toHaveLength(4);
  });

  it("rejects wrong number of dimensions", () => {
    expect(() =>
      SelfReviewChecklistSchema.parse({
        dimensions: ALL_PASSED_DIMS.slice(0, 3),
        overallConfidence: "high",
      }),
    ).toThrow();
  });

  it("accepts dimension with note", () => {
    const dims = ALL_PASSED_DIMS.map((d, i) =>
      i === 0 ? { ...d, note: "All criteria addressed" } : d,
    );
    const checklist = SelfReviewChecklistSchema.parse({
      dimensions: dims,
      overallConfidence: "medium",
    });
    expect(checklist.dimensions[0].note).toBe("All criteria addressed");
  });
});

describe("AgentStatusReportSchema", () => {
  it("parses DONE report with default empty concerns", () => {
    const report = AgentStatusReportSchema.parse({
      status: "DONE",
      selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
    });
    expect(report.concerns).toEqual([]);
  });

  it("parses DONE_WITH_CONCERNS with concerns list", () => {
    const report = AgentStatusReportSchema.parse({
      status: "DONE_WITH_CONCERNS",
      concerns: [{ area: "edge case", description: "Unhandled null", severity: "warning" }],
      selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "medium" },
    });
    expect(report.concerns).toHaveLength(1);
  });
});

describe("isSuccessfulStatus", () => {
  it("returns true for DONE", () => expect(isSuccessfulStatus("DONE")).toBe(true));
  it("returns true for DONE_WITH_CONCERNS", () =>
    expect(isSuccessfulStatus("DONE_WITH_CONCERNS")).toBe(true));
  it("returns false for NEEDS_CONTEXT", () =>
    expect(isSuccessfulStatus("NEEDS_CONTEXT")).toBe(false));
  it("returns false for BLOCKED", () => expect(isSuccessfulStatus("BLOCKED")).toBe(false));
});

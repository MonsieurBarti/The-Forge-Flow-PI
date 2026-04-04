// src/hexagons/review/domain/review-ui.schemas.spec.ts
import { describe, expect, it } from "vitest";
import {
  ApprovalUIContextSchema,
  ApprovalUIResponseSchema,
  FindingsUIContextSchema,
  FindingsUIResponseSchema,
  VerificationUIContextSchema,
  VerificationUIResponseSchema,
} from "./review-ui.schemas";

describe("FindingsUIContextSchema", () => {
  it("accepts valid findings context", () => {
    const result = FindingsUIContextSchema.safeParse({
      sliceId: "slice-1",
      sliceLabel: "M05-S05",
      verdict: "approved",
      findings: [],
      conflicts: [],
      fixCyclesUsed: 0,
      timedOutReviewers: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing sliceId", () => {
    const result = FindingsUIContextSchema.safeParse({
      sliceLabel: "M05-S05",
      verdict: "approved",
      findings: [],
      conflicts: [],
      fixCyclesUsed: 0,
      timedOutReviewers: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid verdict", () => {
    const result = FindingsUIContextSchema.safeParse({
      sliceId: "s1",
      sliceLabel: "M05-S05",
      verdict: "invalid",
      findings: [],
      conflicts: [],
      fixCyclesUsed: 0,
      timedOutReviewers: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("FindingsUIResponseSchema", () => {
  it("accepts valid response", () => {
    const result = FindingsUIResponseSchema.safeParse({
      acknowledged: true,
      formattedOutput: "## Findings\n...",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty formattedOutput", () => {
    const result = FindingsUIResponseSchema.safeParse({
      acknowledged: true,
      formattedOutput: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("VerificationUIContextSchema", () => {
  it("accepts valid verification context", () => {
    const result = VerificationUIContextSchema.safeParse({
      sliceId: "slice-1",
      sliceLabel: "M05-S05",
      criteria: [{ criterion: "AC1", verdict: "PASS", evidence: "test output" }],
      overallVerdict: "PASS",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid verdict enum", () => {
    const result = VerificationUIContextSchema.safeParse({
      sliceId: "s1",
      sliceLabel: "M05-S05",
      criteria: [],
      overallVerdict: "MAYBE",
    });
    expect(result.success).toBe(false);
  });
});

describe("VerificationUIResponseSchema", () => {
  it("accepts valid response", () => {
    const result = VerificationUIResponseSchema.safeParse({
      accepted: false,
      formattedOutput: "## Verification\n...",
    });
    expect(result.success).toBe(true);
  });
});

describe("ApprovalUIContextSchema", () => {
  it("accepts valid approval context", () => {
    const result = ApprovalUIContextSchema.safeParse({
      sliceId: "slice-1",
      sliceLabel: "M05-S05",
      artifactType: "spec",
      artifactPath: ".tff/milestones/M05/slices/M05-S05/SPEC.md",
      summary: "Review UI port spec",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid artifactType", () => {
    const result = ApprovalUIContextSchema.safeParse({
      sliceId: "s1",
      sliceLabel: "M05-S05",
      artifactType: "readme",
      artifactPath: "/foo",
      summary: "x",
    });
    expect(result.success).toBe(false);
  });
});

describe("ApprovalUIResponseSchema", () => {
  it("accepts response with decision", () => {
    const result = ApprovalUIResponseSchema.safeParse({
      decision: "approved",
      formattedOutput: "Approved.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts response without decision (terminal adapter)", () => {
    const result = ApprovalUIResponseSchema.safeParse({
      formattedOutput: "## Plan at ...",
    });
    expect(result.success).toBe(true);
  });

  it("accepts response with feedback", () => {
    const result = ApprovalUIResponseSchema.safeParse({
      decision: "changes_requested",
      feedback: "Fix section 3",
      formattedOutput: "Changes requested.",
    });
    expect(result.success).toBe(true);
  });
});

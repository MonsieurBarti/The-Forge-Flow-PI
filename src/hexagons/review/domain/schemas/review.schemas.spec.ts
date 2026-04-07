import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import {
  ConflictPropsSchema,
  MergedFindingPropsSchema,
  MergedReviewPropsSchema,
} from "./merged-review.schemas";
import {
  FindingImpactSchema,
  FindingPropsSchema,
  ReviewPropsSchema,
  ReviewRoleSchema,
  ReviewSeveritySchema,
  ReviewStrategySchema,
  ReviewVerdictSchema,
} from "./review.schemas";

describe("ReviewSeveritySchema", () => {
  it("accepts all 5 valid levels", () => {
    for (const level of ["critical", "high", "medium", "low", "info"]) {
      expect(ReviewSeveritySchema.parse(level)).toBe(level);
    }
  });

  it("rejects invalid severity", () => {
    expect(() => ReviewSeveritySchema.parse("catastrophic")).toThrow();
    expect(() => ReviewSeveritySchema.parse("major")).toThrow();
  });
});

describe("ReviewVerdictSchema", () => {
  it("accepts valid verdicts", () => {
    for (const v of ["approved", "changes_requested", "rejected"]) {
      expect(ReviewVerdictSchema.parse(v)).toBe(v);
    }
  });
});

describe("ReviewRoleSchema", () => {
  it("accepts valid roles", () => {
    for (const r of ["tff-code-reviewer", "tff-spec-reviewer", "tff-security-auditor"]) {
      expect(ReviewRoleSchema.parse(r)).toBe(r);
    }
  });
});

describe("FindingPropsSchema", () => {
  const valid = {
    id: faker.string.uuid(),
    severity: "high",
    message: "Potential SQL injection",
    filePath: "src/api/handler.ts",
    lineStart: 42,
  };

  it("accepts valid finding with required fields only", () => {
    const result = FindingPropsSchema.parse(valid);
    expect(result.lineEnd).toBeUndefined();
    expect(result.suggestion).toBeUndefined();
    expect(result.ruleId).toBeUndefined();
  });

  it("accepts optional fields", () => {
    const result = FindingPropsSchema.parse({
      ...valid,
      lineEnd: 50,
      suggestion: "Use parameterized queries",
      ruleId: "OWASP-A03",
    });
    expect(result.lineEnd).toBe(50);
    expect(result.suggestion).toBe("Use parameterized queries");
    expect(result.ruleId).toBe("OWASP-A03");
  });

  it("rejects empty message", () => {
    expect(() => FindingPropsSchema.parse({ ...valid, message: "" })).toThrow();
  });

  it("rejects non-positive lineStart", () => {
    expect(() => FindingPropsSchema.parse({ ...valid, lineStart: 0 })).toThrow();
  });
});

describe("ReviewPropsSchema", () => {
  it("accepts valid review props", () => {
    const result = ReviewPropsSchema.parse({
      id: faker.string.uuid(),
      sliceId: faker.string.uuid(),
      role: "tff-code-reviewer",
      agentIdentity: "agent-abc-123",
      verdict: "approved",
      findings: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.verdict).toBe("approved");
  });
});

describe("MergedFindingPropsSchema", () => {
  it("extends FindingPropsSchema with sourceReviewIds", () => {
    const result = MergedFindingPropsSchema.parse({
      id: faker.string.uuid(),
      severity: "medium",
      message: "Unused import",
      filePath: "src/foo.ts",
      lineStart: 1,
      sourceReviewIds: [faker.string.uuid()],
    });
    expect(result.sourceReviewIds).toHaveLength(1);
  });

  it("rejects empty sourceReviewIds", () => {
    expect(() =>
      MergedFindingPropsSchema.parse({
        id: faker.string.uuid(),
        severity: "low",
        message: "msg",
        filePath: "f.ts",
        lineStart: 1,
        sourceReviewIds: [],
      }),
    ).toThrow();
  });
});

describe("ConflictPropsSchema", () => {
  it("requires at least 2 reviewer verdicts", () => {
    expect(() =>
      ConflictPropsSchema.parse({
        filePath: "src/foo.ts",
        lineStart: 10,
        description: "Disagreement on severity",
        reviewerVerdicts: [
          { reviewId: faker.string.uuid(), role: "tff-code-reviewer", severity: "high" },
        ],
      }),
    ).toThrow();
  });
});

describe("FindingImpactSchema", () => {
  it("accepts all 3 valid impact levels", () => {
    for (const level of ["must-fix", "should-fix", "nice-to-have"]) {
      expect(FindingImpactSchema.parse(level)).toBe(level);
    }
  });

  it("rejects invalid impact", () => {
    expect(() => FindingImpactSchema.parse("critical")).toThrow();
    expect(() => FindingImpactSchema.parse("optional")).toThrow();
  });
});

describe("ReviewStrategySchema", () => {
  it("accepts valid strategies", () => {
    for (const s of ["standard", "critique-then-reflection"]) {
      expect(ReviewStrategySchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid strategy", () => {
    expect(() => ReviewStrategySchema.parse("two-pass")).toThrow();
  });
});

describe("FindingPropsSchema — impact field", () => {
  const base = {
    id: faker.string.uuid(),
    severity: "high",
    message: "Test finding",
    filePath: "src/foo.ts",
    lineStart: 10,
  };

  it("accepts finding without impact (backward-compatible)", () => {
    const result = FindingPropsSchema.parse(base);
    expect(result.impact).toBeUndefined();
  });

  it("accepts finding with valid impact", () => {
    const result = FindingPropsSchema.parse({ ...base, impact: "must-fix" });
    expect(result.impact).toBe("must-fix");
  });

  it("allows severity:low + impact:must-fix (independent dimensions)", () => {
    const result = FindingPropsSchema.parse({ ...base, severity: "low", impact: "must-fix" });
    expect(result.severity).toBe("low");
    expect(result.impact).toBe("must-fix");
  });

  it("rejects invalid impact value", () => {
    expect(() => FindingPropsSchema.parse({ ...base, impact: "blocker" })).toThrow();
  });
});

describe("MergedReviewPropsSchema", () => {
  it("accepts valid merged review", () => {
    const result = MergedReviewPropsSchema.parse({
      sliceId: faker.string.uuid(),
      sourceReviewIds: [faker.string.uuid(), faker.string.uuid()],
      verdict: "approved",
      findings: [],
      conflicts: [],
      mergedAt: new Date(),
    });
    expect(result.verdict).toBe("approved");
  });
});

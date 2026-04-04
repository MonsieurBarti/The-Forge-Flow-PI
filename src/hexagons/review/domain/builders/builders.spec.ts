import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { FindingBuilder } from "./finding.builder";
import { ReviewBuilder } from "./review.builder";
import { FindingPropsSchema, ReviewPropsSchema } from "../schemas/review.schemas";

describe("FindingBuilder", () => {
  it("produces schema-conformant data (AC18)", () => {
    const finding = new FindingBuilder().build();
    expect(() => FindingPropsSchema.parse(finding)).not.toThrow();
  });

  it("applies fluent setters", () => {
    const finding = new FindingBuilder()
      .withSeverity("critical")
      .withFilePath("src/danger.ts")
      .withLineStart(42)
      .withMessage("SQL injection risk")
      .build();
    expect(finding.severity).toBe("critical");
    expect(finding.filePath).toBe("src/danger.ts");
    expect(finding.lineStart).toBe(42);
    expect(finding.message).toBe("SQL injection risk");
  });

  it("withId sets custom ID", () => {
    const id = faker.string.uuid();
    const finding = new FindingBuilder().withId(id).build();
    expect(finding.id).toBe(id);
  });

  it("withImpact sets impact field", () => {
    const finding = new FindingBuilder().withImpact("must-fix").build();
    expect(finding.impact).toBe("must-fix");
  });

  it("build without withImpact produces undefined impact", () => {
    const finding = new FindingBuilder().build();
    expect(finding.impact).toBeUndefined();
  });
});

describe("ReviewBuilder", () => {
  it("builds valid Review aggregate (AC18)", () => {
    const review = new ReviewBuilder().build();
    expect(review.verdict).toBe("approved");
  });

  it("buildProps returns valid raw props (AC18)", () => {
    const props = new ReviewBuilder().buildProps();
    expect(() => ReviewPropsSchema.parse(props)).not.toThrow();
  });

  it("respects withFindings", () => {
    const findings = [new FindingBuilder().withSeverity("critical").build()];
    const review = new ReviewBuilder().withFindings(findings).build();
    expect(review.verdict).toBe("changes_requested");
    expect(review.findings).toHaveLength(1);
  });

  it("respects withSliceId", () => {
    const sliceId = "a0000000-b000-4000-8000-c00000000001";
    const review = new ReviewBuilder().withSliceId(sliceId).build();
    expect(review.sliceId).toBe(sliceId);
  });

  it("respects withRole", () => {
    const review = new ReviewBuilder().withRole("security-auditor").build();
    expect(review.role).toBe("security-auditor");
  });
});

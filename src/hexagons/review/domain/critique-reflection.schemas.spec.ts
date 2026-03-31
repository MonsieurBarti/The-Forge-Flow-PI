import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import {
  CritiquePassResultSchema,
  CritiqueReflectionResultSchema,
  ProcessedReviewResultSchema,
  ReflectionInsightSchema,
  ReflectionPassResultSchema,
} from "./critique-reflection.schemas";

const makeFinding = (overrides = {}) => ({
  id: faker.string.uuid(),
  severity: "medium",
  message: faker.lorem.sentence(),
  filePath: `src/${faker.system.fileName()}`,
  lineStart: faker.number.int({ min: 1, max: 500 }),
  ...overrides,
});

describe("CritiquePassResultSchema", () => {
  it("accepts valid critique pass with findings", () => {
    const result = CritiquePassResultSchema.parse({
      rawFindings: [makeFinding(), makeFinding()],
    });
    expect(result.rawFindings).toHaveLength(2);
  });

  it("accepts empty rawFindings", () => {
    const result = CritiquePassResultSchema.parse({ rawFindings: [] });
    expect(result.rawFindings).toHaveLength(0);
  });
});

describe("ReflectionInsightSchema", () => {
  it("accepts valid insight", () => {
    const result = ReflectionInsightSchema.parse({
      theme: "Error handling inconsistency",
      affectedFindings: [faker.string.uuid()],
      recommendation: "Standardize error handling across modules",
    });
    expect(result.theme).toBe("Error handling inconsistency");
  });

  it("rejects empty theme", () => {
    expect(() =>
      ReflectionInsightSchema.parse({
        theme: "",
        affectedFindings: [],
        recommendation: "Fix it",
      }),
    ).toThrow();
  });
});

describe("ReflectionPassResultSchema", () => {
  it("requires impact on prioritized findings", () => {
    expect(() =>
      ReflectionPassResultSchema.parse({
        prioritizedFindings: [makeFinding()], // no impact
        insights: [],
        summary: "All good",
      }),
    ).toThrow();
  });

  it("accepts findings with impact", () => {
    const result = ReflectionPassResultSchema.parse({
      prioritizedFindings: [makeFinding({ impact: "must-fix" })],
      insights: [],
      summary: "One critical issue found",
    });
    expect(result.prioritizedFindings[0].impact).toBe("must-fix");
  });
});

describe("CritiqueReflectionResultSchema", () => {
  it("accepts full valid CTR result", () => {
    const findingId = faker.string.uuid();
    const result = CritiqueReflectionResultSchema.parse({
      critique: { rawFindings: [makeFinding({ id: findingId })] },
      reflection: {
        prioritizedFindings: [makeFinding({ id: findingId, impact: "should-fix" })],
        insights: [
          {
            theme: "Test coverage",
            affectedFindings: [findingId],
            recommendation: "Add edge cases",
          },
        ],
        summary: "Minor issues only",
      },
    });
    expect(result.critique.rawFindings).toHaveLength(1);
    expect(result.reflection.prioritizedFindings).toHaveLength(1);
  });
});

describe("ProcessedReviewResultSchema", () => {
  it("requires impact on all findings", () => {
    expect(() =>
      ProcessedReviewResultSchema.parse({
        findings: [makeFinding()], // no impact
        insights: [],
        summary: "Done",
      }),
    ).toThrow();
  });

  it("accepts valid processed result", () => {
    const result = ProcessedReviewResultSchema.parse({
      findings: [makeFinding({ impact: "nice-to-have" })],
      insights: [],
      summary: "Clean code",
    });
    expect(result.findings[0].impact).toBe("nice-to-have");
  });
});

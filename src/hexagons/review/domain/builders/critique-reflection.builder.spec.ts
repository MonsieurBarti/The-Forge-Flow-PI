import { describe, expect, it } from "vitest";
import { CritiqueReflectionResultSchema } from "../schemas/critique-reflection.schemas";
import { CritiqueReflectionResultBuilder } from "./critique-reflection.builder";

describe("CritiqueReflectionResultBuilder", () => {
  it("produces coordinated IDs: prioritizedFindings IDs match rawFindings IDs (AC20)", () => {
    const result = new CritiqueReflectionResultBuilder().withFindings(3).build();
    const rawIds = result.critique.rawFindings.map((f) => f.id);
    const prioIds = result.reflection.prioritizedFindings.map((f) => f.id);
    expect(prioIds).toEqual(rawIds);
  });

  it("all prioritized findings have impact set", () => {
    const result = new CritiqueReflectionResultBuilder().withFindings(2).build();
    for (const f of result.reflection.prioritizedFindings) {
      expect(f.impact).toBeDefined();
    }
  });

  it("builds schema-valid output", () => {
    const result = new CritiqueReflectionResultBuilder().withFindings(2).build();
    expect(() => CritiqueReflectionResultSchema.parse(result)).not.toThrow();
  });

  it("builds valid output with zero findings", () => {
    const result = new CritiqueReflectionResultBuilder()
      .withRawFindings([])
      .withSummary("Clean")
      .build();
    expect(() => CritiqueReflectionResultSchema.parse(result)).not.toThrow();
    expect(result.critique.rawFindings).toHaveLength(0);
  });
});

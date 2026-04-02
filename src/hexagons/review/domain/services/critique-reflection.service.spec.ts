import { faker } from "@faker-js/faker";
import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { CritiqueReflectionResultBuilder } from "../critique-reflection.builder";
import { FindingBuilder } from "../finding.builder";
import { CritiqueReflectionService } from "./critique-reflection.service";

describe("CritiqueReflectionService", () => {
  const service = new CritiqueReflectionService();

  describe("processResult — happy path", () => {
    it("returns Ok with processed result for valid CTR output (AC9)", () => {
      const ctr = new CritiqueReflectionResultBuilder().withFindings(3).build();
      const result = service.processResult(ctr);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.findings).toHaveLength(3);
        expect(result.data.findings.every((f) => f.impact !== undefined)).toBe(true);
        expect(result.data.summary).toBeTruthy();
      }
    });

    it("returns Ok for empty findings — clean review (AC14)", () => {
      const ctr = new CritiqueReflectionResultBuilder()
        .withRawFindings([])
        .withSummary("No issues found")
        .build();
      const result = service.processResult(ctr);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.findings).toHaveLength(0);
      }
    });
  });

  describe("processResult — invariant violations", () => {
    it("rejects invented finding IDs (AC10)", () => {
      const f1 = new FindingBuilder().withId(faker.string.uuid()).build();
      const inventedId = faker.string.uuid();
      const ctr = {
        critique: { rawFindings: [f1] },
        reflection: {
          prioritizedFindings: [{ ...f1, id: inventedId, impact: "must-fix" as const }],
          insights: [],
          summary: "Found issues",
        },
      };
      const result = service.processResult(ctr);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("REVIEW.CRITIQUE_REFLECTION_FAILED");
        expect(result.error.message).toContain("invented");
      }
    });

    it("rejects omitted findings (AC11)", () => {
      const f1 = new FindingBuilder().withId(faker.string.uuid()).build();
      const f2 = new FindingBuilder().withId(faker.string.uuid()).build();
      const ctr = {
        critique: { rawFindings: [f1, f2] },
        reflection: {
          prioritizedFindings: [{ ...f1, impact: "must-fix" as const }],
          insights: [],
          summary: "Partial",
        },
      };
      const result = service.processResult(ctr);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("missing");
      }
    });

    it("rejects malformed input (AC12)", () => {
      const result = service.processResult({ garbage: true });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("REVIEW.CRITIQUE_REFLECTION_FAILED");
      }
    });

    it("rejects phantom insight references (AC13)", () => {
      const f1 = new FindingBuilder().withId(faker.string.uuid()).build();
      const phantomId = faker.string.uuid();
      const ctr = {
        critique: { rawFindings: [f1] },
        reflection: {
          prioritizedFindings: [{ ...f1, impact: "should-fix" as const }],
          insights: [{ theme: "Phantom", affectedFindings: [phantomId], recommendation: "Fix" }],
          summary: "Issues found",
        },
      };
      const result = service.processResult(ctr);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("phantom");
      }
    });
  });
});

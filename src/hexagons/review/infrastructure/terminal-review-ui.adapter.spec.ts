import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { FindingBuilder } from "../domain/finding.builder";
import { TerminalReviewUIAdapter } from "./terminal-review-ui.adapter";

describe("TerminalReviewUIAdapter", () => {
  const adapter = new TerminalReviewUIAdapter();

  describe("presentFindings", () => {
    it("formats findings sorted by severity — critical first (AC2)", async () => {
      const ctx = {
        sliceId: "s1",
        sliceLabel: "M05-S05",
        verdict: "changes_requested" as const,
        findings: [
          new FindingBuilder().withSeverity("low").withMessage("minor").build(),
          new FindingBuilder().withSeverity("critical").withMessage("blocker").build(),
        ],
        conflicts: [],
        fixCyclesUsed: 0,
        timedOutReviewers: [],
      };
      const result = await adapter.presentFindings(ctx);
      expect(isOk(result)).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      const output = result.data.formattedOutput;
      const criticalIdx = output.indexOf("blocker");
      const lowIdx = output.indexOf("minor");
      expect(criticalIdx).toBeLessThan(lowIdx);
      expect(result.data.formattedOutput.length).toBeGreaterThan(0); // AC15
    });

    it("renders conflicts in a dedicated section (AC2)", async () => {
      const ctx = {
        sliceId: "s1",
        sliceLabel: "M05-S05",
        verdict: "changes_requested" as const,
        findings: [],
        conflicts: [
          {
            filePath: "foo.ts",
            lineStart: 12,
            description: "severity mismatch",
            reviewerVerdicts: [
              { reviewId: "r1", role: "code-reviewer" as const, severity: "medium" as const },
              { reviewId: "r2", role: "security-auditor" as const, severity: "critical" as const },
            ],
          },
        ],
        fixCyclesUsed: 0,
        timedOutReviewers: [],
      };
      const result = await adapter.presentFindings(ctx);
      expect(isOk(result)).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.formattedOutput).toContain("Conflict");
      expect(result.data.formattedOutput).toContain("foo.ts");
    });

    it("returns Ok without plannotator (AC3)", async () => {
      const ctx = {
        sliceId: "s1",
        sliceLabel: "M05-S05",
        verdict: "approved" as const,
        findings: [],
        conflicts: [],
        fixCyclesUsed: 0,
        timedOutReviewers: [],
      };
      const result = await adapter.presentFindings(ctx);
      expect(isOk(result)).toBe(true);
    });
  });

  describe("presentVerification", () => {
    it("formats criteria as PASS/FAIL table with evidence (AC16)", async () => {
      const ctx = {
        sliceId: "s1",
        sliceLabel: "M05-S05",
        criteria: [
          { criterion: "AC1", verdict: "PASS" as const, evidence: "test passed" },
          { criterion: "AC2", verdict: "FAIL" as const, evidence: "missing export" },
        ],
        overallVerdict: "FAIL" as const,
      };
      const result = await adapter.presentVerification(ctx);
      expect(isOk(result)).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.formattedOutput).toContain("PASS");
      expect(result.data.formattedOutput).toContain("FAIL");
      expect(result.data.formattedOutput).toContain("test passed");
      expect(result.data.formattedOutput).toContain("missing export");
      expect(result.data.formattedOutput.length).toBeGreaterThan(0); // AC15
    });
  });

  describe("presentForApproval", () => {
    it("returns formattedOutput with artifact info, no decision (terminal is formatter only)", async () => {
      const ctx = {
        sliceId: "s1",
        sliceLabel: "M05-S05",
        artifactType: "spec" as const,
        artifactPath: ".tff/milestones/M05/slices/M05-S05/SPEC.md",
        summary: "Review UI port spec",
      };
      const result = await adapter.presentForApproval(ctx);
      expect(isOk(result)).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.formattedOutput).toContain("SPEC.md");
      expect(result.data.formattedOutput).toContain("Review UI port spec");
      expect(result.data.decision).toBeUndefined(); // terminal does NOT make decisions
      expect(result.data.formattedOutput.length).toBeGreaterThan(0); // AC15
    });
  });
});

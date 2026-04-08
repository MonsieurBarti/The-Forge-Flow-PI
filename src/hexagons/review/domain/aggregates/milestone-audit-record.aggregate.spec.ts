import { describe, expect, it } from "vitest";
import { MilestoneAuditRecord } from "./milestone-audit-record.aggregate";

describe("MilestoneAuditRecord", () => {
  const baseParams = {
    id: crypto.randomUUID(),
    milestoneId: crypto.randomUUID(),
    milestoneLabel: "M07",
    now: new Date(),
  };

  describe("createNew", () => {
    it("creates record with allPassed=true when both reports PASS", () => {
      const record = MilestoneAuditRecord.createNew({
        ...baseParams,
        auditReports: [
          { agentType: "tff-spec-reviewer", verdict: "PASS", findings: [], summary: "OK" },
          { agentType: "tff-security-auditor", verdict: "PASS", findings: [], summary: "OK" },
        ],
      });
      expect(record.allPassed).toBe(true);
      expect(record.unresolvedCount).toBe(0);
    });

    it("creates record with allPassed=false when one report FAILS", () => {
      const record = MilestoneAuditRecord.createNew({
        ...baseParams,
        auditReports: [
          {
            agentType: "tff-spec-reviewer",
            verdict: "FAIL",
            findings: [
              {
                id: crypto.randomUUID(),
                severity: "high",
                message: "Missing impl",
                filePath: "src/foo.ts",
                lineStart: 1,
              },
            ],
            summary: "Issues found",
          },
          { agentType: "tff-security-auditor", verdict: "PASS", findings: [], summary: "OK" },
        ],
      });
      expect(record.allPassed).toBe(false);
      expect(record.unresolvedCount).toBe(1);
    });

    it("counts all findings across reports", () => {
      const record = MilestoneAuditRecord.createNew({
        ...baseParams,
        auditReports: [
          {
            agentType: "tff-spec-reviewer",
            verdict: "FAIL",
            findings: [
              {
                id: crypto.randomUUID(),
                severity: "high",
                message: "A",
                filePath: "a.ts",
                lineStart: 1,
              },
              {
                id: crypto.randomUUID(),
                severity: "medium",
                message: "B",
                filePath: "b.ts",
                lineStart: 2,
              },
            ],
            summary: "Issues",
          },
          {
            agentType: "tff-security-auditor",
            verdict: "FAIL",
            findings: [
              {
                id: crypto.randomUUID(),
                severity: "critical",
                message: "C",
                filePath: "c.ts",
                lineStart: 3,
              },
            ],
            summary: "Issues",
          },
        ],
      });
      expect(record.unresolvedCount).toBe(3);
    });
  });

  describe("reconstitute", () => {
    it("roundtrips through toJSON", () => {
      const original = MilestoneAuditRecord.createNew({
        ...baseParams,
        auditReports: [
          { agentType: "tff-spec-reviewer", verdict: "PASS", findings: [], summary: "OK" },
          { agentType: "tff-security-auditor", verdict: "PASS", findings: [], summary: "OK" },
        ],
      });
      const reconstituted = MilestoneAuditRecord.reconstitute(original.toJSON());
      expect(reconstituted.id).toBe(original.id);
      expect(reconstituted.allPassed).toBe(original.allPassed);
      expect(reconstituted.milestoneLabel).toBe(original.milestoneLabel);
    });
  });
});

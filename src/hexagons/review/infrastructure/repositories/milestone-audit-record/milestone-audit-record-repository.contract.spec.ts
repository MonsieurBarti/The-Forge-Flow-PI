import { isOk } from "@kernel";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { MilestoneAuditRecord } from "../../../domain/aggregates/milestone-audit-record.aggregate";
import type { MilestoneAuditRecordRepositoryPort } from "../../../domain/ports/milestone-audit-record-repository.port";
import { InMemoryMilestoneAuditRecordRepository } from "./in-memory-milestone-audit-record.repository";
import { SqliteMilestoneAuditRecordRepository } from "./sqlite-milestone-audit-record.repository";

function createRecord(
  overrides: { milestoneId?: string; allPassed?: boolean; auditedAt?: Date } = {},
): MilestoneAuditRecord {
  const milestoneId = overrides.milestoneId ?? crypto.randomUUID();
  const verdict = overrides.allPassed === false ? "FAIL" : "PASS";
  const findings =
    overrides.allPassed === false
      ? [
          {
            id: crypto.randomUUID(),
            severity: "high" as const,
            message: "Issue",
            filePath: "a.ts",
            lineStart: 1,
          },
        ]
      : [];
  return MilestoneAuditRecord.createNew({
    id: crypto.randomUUID(),
    milestoneId,
    milestoneLabel: "M07",
    auditReports: [
      { agentType: "tff-spec-reviewer", verdict, findings, summary: "Test" },
      { agentType: "tff-security-auditor", verdict: "PASS", findings: [], summary: "OK" },
    ],
    now: overrides.auditedAt ?? new Date(),
  });
}

function runContractTests(
  name: string,
  factory: () => MilestoneAuditRecordRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: MilestoneAuditRecordRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findLatestByMilestoneId roundtrip", async () => {
      const record = createRecord();
      await repo.save(record);

      const result = await repo.findLatestByMilestoneId(record.milestoneId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBeNull();
        expect(result.data?.id).toBe(record.id);
        expect(result.data?.allPassed).toBe(record.allPassed);
      }
    });

    it("findLatestByMilestoneId returns null when none exist", async () => {
      const result = await repo.findLatestByMilestoneId(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("findLatestByMilestoneId returns most recent record", async () => {
      const milestoneId = crypto.randomUUID();
      const older = createRecord({
        milestoneId,
        allPassed: false,
        auditedAt: new Date("2026-01-01"),
      });
      const newer = createRecord({
        milestoneId,
        allPassed: true,
        auditedAt: new Date("2026-04-01"),
      });
      await repo.save(older);
      await repo.save(newer);

      const result = await repo.findLatestByMilestoneId(milestoneId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data?.id).toBe(newer.id);
        expect(result.data?.allPassed).toBe(true);
      }
    });

    it("saves record with failing audit", async () => {
      const record = createRecord({ allPassed: false });
      await repo.save(record);

      const result = await repo.findLatestByMilestoneId(record.milestoneId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data?.allPassed).toBe(false);
        expect(result.data?.unresolvedCount).toBeGreaterThan(0);
      }
    });
  });
}

runContractTests(
  "InMemoryMilestoneAuditRecordRepository",
  () => new InMemoryMilestoneAuditRecordRepository(),
);

runContractTests("SqliteMilestoneAuditRecordRepository", () => {
  const db = new Database(":memory:");
  return new SqliteMilestoneAuditRecordRepository(db);
});

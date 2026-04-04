import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import type { AuditReportProps } from "../../../domain/schemas/completion.schemas";
import { CompletionRecord } from "../../../domain/aggregates/completion-record.aggregate";
import { SqliteCompletionRecordRepository } from "./sqlite-completion-record.repository";

const NOW = new Date("2026-04-02T12:00:00Z");

function makeAuditReports(): AuditReportProps[] {
  return [
    {
      agentType: "spec-reviewer",
      verdict: "PASS",
      findings: [
        {
          id: crypto.randomUUID(),
          severity: "low",
          message: "Minor naming inconsistency",
          filePath: "src/foo.ts",
          lineStart: 10,
        },
      ],
      summary: "Spec review passed with minor findings",
    },
    {
      agentType: "security-auditor",
      verdict: "PASS",
      findings: [],
      summary: "No security issues found",
    },
  ];
}

function makeRecord(params: { id: string; milestoneId: string }): CompletionRecord {
  return CompletionRecord.createNew({
    id: params.id,
    milestoneId: params.milestoneId,
    milestoneLabel: "M05",
    prNumber: 99,
    prUrl: "https://github.com/org/repo/pull/99",
    headBranch: "milestone/M05",
    baseBranch: "main",
    auditReports: makeAuditReports(),
    now: NOW,
  });
}

describe("SqliteCompletionRecordRepository", () => {
  let db: Database.Database;
  let repo: SqliteCompletionRecordRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    repo = new SqliteCompletionRecordRepository(db);
  });

  it("save + findByMilestoneId round-trip", async () => {
    const milestoneId = crypto.randomUUID();
    const record = makeRecord({ id: crypto.randomUUID(), milestoneId });

    await repo.save(record);

    const result = await repo.findByMilestoneId(milestoneId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).not.toBeNull();
    expect(result.data?.toJSON()).toEqual(record.toJSON());
  });

  it("upsert on duplicate id (save, recordMerge, save again -> merged)", async () => {
    const milestoneId = crypto.randomUUID();
    const id = crypto.randomUUID();
    const record = makeRecord({ id, milestoneId });

    await repo.save(record);

    record.recordMerge(2, NOW);
    await repo.save(record);

    const result = await repo.findByMilestoneId(milestoneId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).not.toBeNull();
    expect(result.data?.isMerged).toBe(true);
    expect(result.data?.toJSON()).toEqual(record.toJSON());
  });

  it("findByMilestoneId returns null for unknown milestone", async () => {
    const result = await repo.findByMilestoneId(crypto.randomUUID());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("reconstituted record has correct props", async () => {
    const milestoneId = crypto.randomUUID();
    const record = makeRecord({ id: crypto.randomUUID(), milestoneId });

    await repo.save(record);

    const result = await repo.findByMilestoneId(milestoneId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const found = result.data;
    expect(found).not.toBeNull();
    expect(found?.milestoneId).toBe(milestoneId);
    expect(found?.auditReports).toHaveLength(2);
    expect(found?.auditReports[0].agentType).toBe("spec-reviewer");
    expect(found?.auditReports[0].verdict).toBe("PASS");
    expect(found?.auditReports[0].findings).toHaveLength(1);
    expect(found?.auditReports[1].agentType).toBe("security-auditor");
    expect(found?.toJSON().outcome).toBeNull();
  });
});

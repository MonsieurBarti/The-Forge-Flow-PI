import { type Id, ok, type PersistenceError, type Result } from "@kernel";
import type Database from "better-sqlite3";
import { z } from "zod";
import { MilestoneAuditRecord } from "../../../domain/aggregates/milestone-audit-record.aggregate";
import { MilestoneAuditRecordRepositoryPort } from "../../../domain/ports/milestone-audit-record-repository.port";
import { AuditReportSchema } from "../../../domain/schemas/completion.schemas";
import type { MilestoneAuditRecordProps } from "../../../domain/schemas/milestone-audit-record.schemas";

interface AuditRecordRow {
  id: string;
  milestone_id: string;
  milestone_label: string;
  audit_reports: string;
  all_passed: number;
  unresolved_count: number;
  audited_at: string;
}

export class SqliteMilestoneAuditRecordRepository extends MilestoneAuditRecordRepositoryPort {
  constructor(private readonly db: Database.Database) {
    super();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS milestone_audit_records (
        id               TEXT NOT NULL PRIMARY KEY,
        milestone_id     TEXT NOT NULL,
        milestone_label  TEXT NOT NULL,
        audit_reports    TEXT NOT NULL,
        all_passed       INTEGER NOT NULL,
        unresolved_count INTEGER NOT NULL,
        audited_at       TEXT NOT NULL
      )
    `);
  }

  async save(record: MilestoneAuditRecord): Promise<Result<void, PersistenceError>> {
    const props = record.toJSON();
    this.db
      .prepare<[string, string, string, string, number, number, string]>(
        `INSERT OR REPLACE INTO milestone_audit_records
         (id, milestone_id, milestone_label, audit_reports, all_passed, unresolved_count, audited_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        props.id,
        props.milestoneId,
        props.milestoneLabel,
        JSON.stringify(props.auditReports),
        props.allPassed ? 1 : 0,
        props.unresolvedCount,
        props.auditedAt.toISOString(),
      );
    return ok(undefined);
  }

  async findLatestByMilestoneId(
    milestoneId: Id,
  ): Promise<Result<MilestoneAuditRecord | null, PersistenceError>> {
    const row = this.db
      .prepare<[string], AuditRecordRow>(
        "SELECT * FROM milestone_audit_records WHERE milestone_id = ? ORDER BY audited_at DESC LIMIT 1",
      )
      .get(milestoneId);
    if (!row) return ok(null);
    return ok(MilestoneAuditRecord.reconstitute(this.toProps(row)));
  }

  reset(): void {
    this.db.exec("DELETE FROM milestone_audit_records");
  }

  private toProps(row: AuditRecordRow): MilestoneAuditRecordProps {
    return {
      id: row.id,
      milestoneId: row.milestone_id,
      milestoneLabel: row.milestone_label,
      auditReports: z.array(AuditReportSchema).parse(JSON.parse(row.audit_reports)),
      allPassed: row.all_passed === 1,
      unresolvedCount: row.unresolved_count,
      auditedAt: new Date(row.audited_at),
    };
  }
}

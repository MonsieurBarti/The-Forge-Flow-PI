import { ok, type PersistenceError, type Result } from "@kernel";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  AuditReportSchema,
  CompletionOutcomeSchema,
  type CompletionRecordProps,
} from "../../../domain/schemas/completion.schemas";
import { CompletionRecord } from "../../../domain/aggregates/completion-record.aggregate";
import { CompletionRecordRepositoryPort } from "../../../domain/ports/completion-record-repository.port";

interface CompletionRecordRow {
  id: string;
  milestone_id: string;
  milestone_label: string;
  pr_number: number;
  pr_url: string;
  head_branch: string;
  base_branch: string;
  audit_reports: string;
  outcome: string | null;
  fix_cycles_used: number;
  created_at: string;
  completed_at: string | null;
}

export class SqliteCompletionRecordRepository extends CompletionRecordRepositoryPort {
  constructor(private readonly db: Database.Database) {
    super();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS completion_records (
        id              TEXT    NOT NULL PRIMARY KEY,
        milestone_id    TEXT    NOT NULL,
        milestone_label TEXT    NOT NULL,
        pr_number       INTEGER NOT NULL,
        pr_url          TEXT    NOT NULL,
        head_branch     TEXT    NOT NULL,
        base_branch     TEXT    NOT NULL,
        audit_reports   TEXT    NOT NULL,
        outcome         TEXT,
        fix_cycles_used INTEGER NOT NULL,
        created_at      TEXT    NOT NULL,
        completed_at    TEXT
      )
    `);
  }

  async save(record: CompletionRecord): Promise<Result<void, PersistenceError>> {
    const props = record.toJSON();
    this.db
      .prepare<
        [
          string,
          string,
          string,
          number,
          string,
          string,
          string,
          string,
          string | null,
          number,
          string,
          string | null,
        ]
      >(`
        INSERT OR REPLACE INTO completion_records
          (id, milestone_id, milestone_label, pr_number, pr_url, head_branch, base_branch, audit_reports, outcome, fix_cycles_used, created_at, completed_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        props.id,
        props.milestoneId,
        props.milestoneLabel,
        props.prNumber,
        props.prUrl,
        props.headBranch,
        props.baseBranch,
        JSON.stringify(props.auditReports),
        props.outcome ?? null,
        props.fixCyclesUsed,
        props.createdAt.toISOString(),
        props.completedAt ? props.completedAt.toISOString() : null,
      );
    return ok(undefined);
  }

  async findByMilestoneId(
    milestoneId: string,
  ): Promise<Result<CompletionRecord | null, PersistenceError>> {
    const row = this.db
      .prepare<[string], CompletionRecordRow>(
        "SELECT * FROM completion_records WHERE milestone_id = ?",
      )
      .get(milestoneId);

    if (!row) {
      return ok(null);
    }

    const auditReports = z.array(AuditReportSchema).parse(JSON.parse(row.audit_reports));

    const props: CompletionRecordProps = {
      id: row.id,
      milestoneId: row.milestone_id,
      milestoneLabel: row.milestone_label,
      prNumber: row.pr_number,
      prUrl: row.pr_url,
      headBranch: row.head_branch,
      baseBranch: row.base_branch,
      auditReports,
      outcome: row.outcome !== null ? CompletionOutcomeSchema.parse(row.outcome) : null,
      fixCyclesUsed: row.fix_cycles_used,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at !== null ? new Date(row.completed_at) : null,
    };

    return ok(CompletionRecord.reconstitute(props));
  }
}

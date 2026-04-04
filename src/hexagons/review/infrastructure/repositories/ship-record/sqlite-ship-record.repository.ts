import { type Id, ok, type PersistenceError, type Result } from "@kernel";
import type Database from "better-sqlite3";

import { ShipRecordRepositoryPort } from "../../../domain/ports/ship-record-repository.port";
import { MergeGateDecisionSchema, type ShipRecordProps } from "../../../domain/schemas/ship.schemas";
import { ShipRecord } from "../../../domain/aggregates/ship-record.aggregate";

interface ShipRecordRow {
  id: string;
  slice_id: string;
  pr_number: number;
  pr_url: string;
  head_branch: string;
  base_branch: string;
  outcome: string | null;
  fix_cycles_used: number;
  created_at: string;
  completed_at: string | null;
}

export class SqliteShipRecordRepository extends ShipRecordRepositoryPort {
  constructor(private readonly db: Database.Database) {
    super();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ship_records (
        id          TEXT    NOT NULL PRIMARY KEY,
        slice_id    TEXT    NOT NULL,
        pr_number   INTEGER NOT NULL,
        pr_url      TEXT    NOT NULL,
        head_branch TEXT    NOT NULL,
        base_branch TEXT    NOT NULL,
        outcome     TEXT,
        fix_cycles_used INTEGER NOT NULL,
        created_at  TEXT    NOT NULL,
        completed_at TEXT
      )
    `);
  }

  async save(record: ShipRecord): Promise<Result<void, PersistenceError>> {
    const props = record.toJSON();
    this.db
      .prepare<
        [
          string,
          string,
          number,
          string,
          string,
          string,
          string | null,
          number,
          string,
          string | null,
        ]
      >(`
        INSERT OR REPLACE INTO ship_records
          (id, slice_id, pr_number, pr_url, head_branch, base_branch, outcome, fix_cycles_used, created_at, completed_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        props.id,
        props.sliceId,
        props.prNumber,
        props.prUrl,
        props.headBranch,
        props.baseBranch,
        props.outcome ?? null,
        props.fixCyclesUsed,
        props.createdAt.toISOString(),
        props.completedAt ? props.completedAt.toISOString() : null,
      );
    return ok(undefined);
  }

  async findBySliceId(sliceId: Id): Promise<Result<ShipRecord[], PersistenceError>> {
    const rows = this.db
      .prepare<[string], ShipRecordRow>("SELECT * FROM ship_records WHERE slice_id = ?")
      .all(sliceId);

    const records = rows.map((row) => {
      const props: ShipRecordProps = {
        id: row.id,
        sliceId: row.slice_id,
        prNumber: row.pr_number,
        prUrl: row.pr_url,
        headBranch: row.head_branch,
        baseBranch: row.base_branch,
        outcome: row.outcome !== null ? MergeGateDecisionSchema.parse(row.outcome) : null,
        fixCyclesUsed: row.fix_cycles_used,
        createdAt: new Date(row.created_at),
        completedAt: row.completed_at !== null ? new Date(row.completed_at) : null,
      };
      return ShipRecord.reconstitute(props);
    });

    return ok(records);
  }
}

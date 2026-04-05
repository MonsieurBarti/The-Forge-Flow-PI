import { type Id, ok, type PersistenceError, type Result } from "@kernel";
import type Database from "better-sqlite3";
import { Verification } from "../../../domain/aggregates/verification.aggregate";
import { VerificationRepositoryPort } from "../../../domain/ports/verification-repository.port";
import type { VerificationProps } from "../../../domain/schemas/verification.schemas";
import { VerificationVerdictSchema } from "../../../domain/schemas/verification.schemas";

interface VerificationRow {
  id: string;
  slice_id: string;
  agent_identity: string;
  criteria: string;
  overall_verdict: string;
  fix_cycle_index: number;
  created_at: string;
}

export class SqliteVerificationRepository extends VerificationRepositoryPort {
  constructor(private readonly db: Database.Database) {
    super();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS verifications (
        id              TEXT    NOT NULL PRIMARY KEY,
        slice_id        TEXT    NOT NULL,
        agent_identity  TEXT    NOT NULL,
        criteria        TEXT    NOT NULL,
        overall_verdict TEXT    NOT NULL,
        fix_cycle_index INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT    NOT NULL
      )
    `);
  }

  async save(verification: Verification): Promise<Result<void, PersistenceError>> {
    const props = verification.toJSON();
    this.db
      .prepare<[string, string, string, string, string, number, string]>(`
        INSERT OR REPLACE INTO verifications
          (id, slice_id, agent_identity, criteria, overall_verdict, fix_cycle_index, created_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        props.id,
        props.sliceId,
        props.agentIdentity,
        JSON.stringify(props.criteria),
        props.overallVerdict,
        props.fixCycleIndex,
        props.createdAt.toISOString(),
      );
    return ok(undefined);
  }

  async findBySliceId(sliceId: Id): Promise<Result<Verification[], PersistenceError>> {
    const rows = this.db
      .prepare<[string], VerificationRow>("SELECT * FROM verifications WHERE slice_id = ?")
      .all(sliceId);
    return ok(rows.map((row) => Verification.reconstitute(this.toProps(row))));
  }

  async findAll(): Promise<Result<Verification[], PersistenceError>> {
    const rows = this.db.prepare<[], VerificationRow>("SELECT * FROM verifications").all();
    return ok(rows.map((row) => Verification.reconstitute(this.toProps(row))));
  }

  reset(): void {
    this.db.exec("DELETE FROM verifications");
  }

  private toProps(row: VerificationRow): VerificationProps {
    return {
      id: row.id,
      sliceId: row.slice_id,
      agentIdentity: row.agent_identity,
      criteria: JSON.parse(row.criteria),
      overallVerdict: VerificationVerdictSchema.parse(row.overall_verdict),
      fixCycleIndex: row.fix_cycle_index,
      createdAt: new Date(row.created_at),
    };
  }
}

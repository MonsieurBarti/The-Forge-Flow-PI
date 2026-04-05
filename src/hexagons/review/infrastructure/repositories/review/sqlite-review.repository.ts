import { type Id, ok, type PersistenceError, type Result } from "@kernel";
import type Database from "better-sqlite3";

import { ReviewRepositoryPort } from "../../../domain/ports/review-repository.port";
import { Review } from "../../../domain/aggregates/review.aggregate";
import {
  type FindingProps,
  type ReviewProps,
  ReviewRoleSchema,
  ReviewVerdictSchema,
} from "../../../domain/schemas/review.schemas";

interface ReviewRow {
  id: string;
  slice_id: string;
  role: string;
  agent_identity: string;
  verdict: string;
  findings: string;
  created_at: string;
  updated_at: string;
}

export class SqliteReviewRepository extends ReviewRepositoryPort {
  constructor(private readonly db: Database.Database) {
    super();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reviews (
        id             TEXT NOT NULL PRIMARY KEY,
        slice_id       TEXT NOT NULL,
        role           TEXT NOT NULL,
        agent_identity TEXT NOT NULL,
        verdict        TEXT NOT NULL,
        findings       TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      )
    `);
  }

  async save(review: Review): Promise<Result<void, PersistenceError>> {
    const props = review.toJSON();
    this.db
      .prepare<[string, string, string, string, string, string, string, string]>(
        `INSERT OR REPLACE INTO reviews
          (id, slice_id, role, agent_identity, verdict, findings, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        props.id,
        props.sliceId,
        props.role,
        props.agentIdentity,
        props.verdict,
        JSON.stringify(props.findings),
        props.createdAt.toISOString(),
        props.updatedAt.toISOString(),
      );
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Review | null, PersistenceError>> {
    const row = this.db
      .prepare<[string], ReviewRow>("SELECT * FROM reviews WHERE id = ?")
      .get(id);
    if (!row) return ok(null);
    return ok(Review.reconstitute(this.toProps(row)));
  }

  async findBySliceId(sliceId: Id): Promise<Result<Review[], PersistenceError>> {
    const rows = this.db
      .prepare<[string], ReviewRow>("SELECT * FROM reviews WHERE slice_id = ?")
      .all(sliceId);
    return ok(rows.map((row) => Review.reconstitute(this.toProps(row))));
  }

  async delete(id: Id): Promise<Result<void, PersistenceError>> {
    this.db.prepare<[string]>("DELETE FROM reviews WHERE id = ?").run(id);
    return ok(undefined);
  }

  async findAll(): Promise<Result<Review[], PersistenceError>> {
    const rows = this.db.prepare<[], ReviewRow>("SELECT * FROM reviews").all();
    return ok(rows.map((row) => Review.reconstitute(this.toProps(row))));
  }

  reset(): void {
    this.db.exec("DELETE FROM reviews");
  }

  private toProps(row: ReviewRow): ReviewProps {
    return {
      id: row.id,
      sliceId: row.slice_id,
      role: ReviewRoleSchema.parse(row.role),
      agentIdentity: row.agent_identity,
      verdict: ReviewVerdictSchema.parse(row.verdict),
      findings: JSON.parse(row.findings) as FindingProps[],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

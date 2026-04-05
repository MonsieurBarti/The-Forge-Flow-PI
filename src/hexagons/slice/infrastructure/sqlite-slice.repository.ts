import { err, type Id, ok, PersistenceError, type Result } from "@kernel";
import type { ComplexityTier } from "@kernel/schemas";
import type Database from "better-sqlite3";
import { SliceRepositoryPort } from "../domain/ports/slice-repository.port";
import { Slice } from "../domain/slice.aggregate";
import type { SliceKind, SliceProps, SliceStatus } from "../domain/slice.schemas";

interface SliceRow {
  id: string;
  milestone_id: string | null;
  kind: string;
  label: string;
  title: string;
  description: string;
  status: string;
  complexity: string | null;
  spec_path: string | null;
  plan_path: string | null;
  research_path: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteSliceRepository extends SliceRepositoryPort {
  constructor(private readonly db: Database.Database) {
    super();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS slices (
        id            TEXT NOT NULL PRIMARY KEY,
        milestone_id  TEXT,
        kind          TEXT NOT NULL DEFAULT 'milestone',
        label         TEXT NOT NULL UNIQUE,
        title         TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL,
        complexity    TEXT,
        spec_path     TEXT,
        plan_path     TEXT,
        research_path TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      )
    `);
  }

  async save(slice: Slice): Promise<Result<void, PersistenceError>> {
    const props = slice.toJSON();

    // Check label uniqueness: different id, same label
    const conflict = this.db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM slices WHERE label = ? AND id != ?",
      )
      .get(props.label, props.id);

    if (conflict) {
      return err(
        new PersistenceError(`Label uniqueness violated: slice '${props.label}' already exists`),
      );
    }

    this.db
      .prepare<
        [
          string,
          string | null,
          string,
          string,
          string,
          string,
          string,
          string | null,
          string | null,
          string | null,
          string | null,
          string,
          string,
        ]
      >(
        `INSERT OR REPLACE INTO slices (id, milestone_id, kind, label, title, description, status, complexity, spec_path, plan_path, research_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        props.id,
        props.milestoneId,
        props.kind,
        props.label,
        props.title,
        props.description,
        props.status,
        props.complexity,
        props.specPath,
        props.planPath,
        props.researchPath,
        props.createdAt.toISOString(),
        props.updatedAt.toISOString(),
      );
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Slice | null, PersistenceError>> {
    const row = this.db.prepare<[string], SliceRow>("SELECT * FROM slices WHERE id = ?").get(id);
    if (!row) return ok(null);
    return ok(Slice.reconstitute(this.toProps(row)));
  }

  async findByLabel(label: string): Promise<Result<Slice | null, PersistenceError>> {
    const row = this.db
      .prepare<[string], SliceRow>("SELECT * FROM slices WHERE label = ?")
      .get(label);
    if (!row) return ok(null);
    return ok(Slice.reconstitute(this.toProps(row)));
  }

  async findByMilestoneId(milestoneId: Id): Promise<Result<Slice[], PersistenceError>> {
    const rows = this.db
      .prepare<[string], SliceRow>("SELECT * FROM slices WHERE milestone_id = ?")
      .all(milestoneId);
    return ok(rows.map((row) => Slice.reconstitute(this.toProps(row))));
  }

  async findByKind(kind: SliceKind): Promise<Result<Slice[], PersistenceError>> {
    const rows = this.db
      .prepare<[string], SliceRow>("SELECT * FROM slices WHERE kind = ?")
      .all(kind);
    return ok(rows.map((row) => Slice.reconstitute(this.toProps(row))));
  }

  reset(): void {
    this.db.exec("DELETE FROM slices");
  }

  private toProps(row: SliceRow): SliceProps {
    return {
      id: row.id,
      milestoneId: row.milestone_id,
      kind: (row.kind ?? "milestone") as SliceProps["kind"],
      label: row.label,
      title: row.title,
      description: row.description,
      status: row.status as SliceStatus,
      complexity: row.complexity as ComplexityTier | null,
      specPath: row.spec_path,
      planPath: row.plan_path,
      researchPath: row.research_path,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

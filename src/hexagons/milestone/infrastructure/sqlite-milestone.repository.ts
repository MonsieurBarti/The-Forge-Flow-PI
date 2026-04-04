import { err, type Id, ok, PersistenceError, type Result } from "@kernel";
import type Database from "better-sqlite3";
import { Milestone } from "../domain/milestone.aggregate";
import type { MilestoneProps, MilestoneStatus } from "../domain/milestone.schemas";
import { MilestoneRepositoryPort } from "../domain/ports/milestone-repository.port";

interface MilestoneRow {
  id: string;
  project_id: string;
  label: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export class SqliteMilestoneRepository extends MilestoneRepositoryPort {
  constructor(private readonly db: Database.Database) {
    super();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS milestones (
        id          TEXT NOT NULL PRIMARY KEY,
        project_id  TEXT NOT NULL,
        label       TEXT NOT NULL UNIQUE,
        title       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )
    `);
  }

  async save(milestone: Milestone): Promise<Result<void, PersistenceError>> {
    const props = milestone.toJSON();

    // Check label uniqueness: different id, same label
    const conflict = this.db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM milestones WHERE label = ? AND id != ?",
      )
      .get(props.label, props.id);

    if (conflict) {
      return err(
        new PersistenceError(
          `Label uniqueness violated: milestone '${props.label}' already exists`,
        ),
      );
    }

    this.db
      .prepare<[string, string, string, string, string, string, string, string]>(
        `INSERT OR REPLACE INTO milestones (id, project_id, label, title, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        props.id,
        props.projectId,
        props.label,
        props.title,
        props.description,
        props.status,
        props.createdAt.toISOString(),
        props.updatedAt.toISOString(),
      );
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Milestone | null, PersistenceError>> {
    const row = this.db
      .prepare<[string], MilestoneRow>("SELECT * FROM milestones WHERE id = ?")
      .get(id);
    if (!row) return ok(null);
    return ok(Milestone.reconstitute(this.toProps(row)));
  }

  async findByLabel(label: string): Promise<Result<Milestone | null, PersistenceError>> {
    const row = this.db
      .prepare<[string], MilestoneRow>("SELECT * FROM milestones WHERE label = ?")
      .get(label);
    if (!row) return ok(null);
    return ok(Milestone.reconstitute(this.toProps(row)));
  }

  async findByProjectId(projectId: Id): Promise<Result<Milestone[], PersistenceError>> {
    const rows = this.db
      .prepare<[string], MilestoneRow>("SELECT * FROM milestones WHERE project_id = ?")
      .all(projectId);
    return ok(rows.map((row) => Milestone.reconstitute(this.toProps(row))));
  }

  reset(): void {
    this.db.exec("DELETE FROM milestones");
  }

  private toProps(row: MilestoneRow): MilestoneProps {
    return {
      id: row.id,
      projectId: row.project_id,
      label: row.label,
      title: row.title,
      description: row.description,
      status: row.status as MilestoneStatus,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

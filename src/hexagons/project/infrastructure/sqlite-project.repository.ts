import { err, type Id, ok, PersistenceError, type Result } from "@kernel";
import type Database from "better-sqlite3";
import { ProjectRepositoryPort } from "../domain/ports/project-repository.port";
import { Project } from "../domain/project.aggregate";
import type { ProjectProps } from "../domain/project.schemas";

interface ProjectRow {
  id: string;
  name: string;
  vision: string;
  created_at: string;
  updated_at: string;
}

export class SqliteProjectRepository extends ProjectRepositoryPort {
  constructor(private readonly db: Database.Database) {
    super();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id         TEXT NOT NULL PRIMARY KEY,
        name       TEXT NOT NULL,
        vision     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  async save(project: Project): Promise<Result<void, PersistenceError>> {
    const props = project.toJSON();

    const existing = this.db.prepare<[], ProjectRow>("SELECT id FROM projects LIMIT 1").get();

    if (existing && existing.id !== props.id) {
      return err(
        new PersistenceError("Project singleton violated: a different project already exists"),
      );
    }

    this.db
      .prepare<[string, string, string, string, string]>(
        `INSERT OR REPLACE INTO projects (id, name, vision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        props.id,
        props.name,
        props.vision,
        props.createdAt.toISOString(),
        props.updatedAt.toISOString(),
      );

    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Project | null, PersistenceError>> {
    const row = this.db
      .prepare<[string], ProjectRow>("SELECT * FROM projects WHERE id = ?")
      .get(id);

    if (!row) return ok(null);
    return ok(Project.reconstitute(this.toProps(row)));
  }

  async findSingleton(): Promise<Result<Project | null, PersistenceError>> {
    const row = this.db.prepare<[], ProjectRow>("SELECT * FROM projects LIMIT 1").get();

    if (!row) return ok(null);
    return ok(Project.reconstitute(this.toProps(row)));
  }

  reset(): void {
    this.db.exec("DELETE FROM projects");
  }

  private toProps(row: ProjectRow): ProjectProps {
    return {
      id: row.id,
      name: row.name,
      vision: row.vision,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

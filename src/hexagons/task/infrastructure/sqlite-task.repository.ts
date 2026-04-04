import { err, type Id, ok, PersistenceError, type Result } from "@kernel";
import type Database from "better-sqlite3";
import { TaskRepositoryPort } from "../domain/ports/task-repository.port";
import { Task } from "../domain/task.aggregate";
import type { TaskProps, TaskStatus } from "../domain/task.schemas";

interface TaskRow {
  id: string;
  slice_id: string;
  label: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  file_paths: string;
  status: string;
  blocked_by: string;
  wave_index: number | null;
  created_at: string;
  updated_at: string;
}

export class SqliteTaskRepository extends TaskRepositoryPort {
  constructor(private readonly db: Database.Database) {
    super();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id                  TEXT    NOT NULL PRIMARY KEY,
        slice_id            TEXT    NOT NULL,
        label               TEXT    NOT NULL,
        title               TEXT    NOT NULL,
        description         TEXT    NOT NULL DEFAULT '',
        acceptance_criteria TEXT    NOT NULL DEFAULT '',
        file_paths          TEXT    NOT NULL DEFAULT '[]',
        status              TEXT    NOT NULL,
        blocked_by          TEXT    NOT NULL DEFAULT '[]',
        wave_index          INTEGER,
        created_at          TEXT    NOT NULL,
        updated_at          TEXT    NOT NULL,
        UNIQUE(slice_id, label)
      )
    `);
  }

  async save(task: Task): Promise<Result<void, PersistenceError>> {
    const props = task.toJSON();

    // Check label uniqueness within slice (different id, same slice+label)
    const existing = this.db
      .prepare<[string, string, string], { id: string }>(
        "SELECT id FROM tasks WHERE slice_id = ? AND label = ? AND id != ?",
      )
      .get(props.sliceId, props.label, props.id);

    if (existing) {
      return err(
        new PersistenceError(
          `Label uniqueness violated: task '${props.label}' already exists in slice '${props.sliceId}'`,
        ),
      );
    }

    this.db
      .prepare<[string, string, string, string, string, string, string, string, string, number | null, string, string]>(
        `INSERT OR REPLACE INTO tasks (id, slice_id, label, title, description, acceptance_criteria, file_paths, status, blocked_by, wave_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        props.id,
        props.sliceId,
        props.label,
        props.title,
        props.description,
        props.acceptanceCriteria,
        JSON.stringify(props.filePaths),
        props.status,
        JSON.stringify(props.blockedBy),
        props.waveIndex,
        props.createdAt.toISOString(),
        props.updatedAt.toISOString(),
      );

    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Task | null, PersistenceError>> {
    const row = this.db
      .prepare<[string], TaskRow>("SELECT * FROM tasks WHERE id = ?")
      .get(id);
    if (!row) return ok(null);
    return ok(Task.reconstitute(this.toProps(row)));
  }

  async findByLabel(label: string): Promise<Result<Task | null, PersistenceError>> {
    const row = this.db
      .prepare<[string], TaskRow>("SELECT * FROM tasks WHERE label = ? LIMIT 1")
      .get(label);
    if (!row) return ok(null);
    return ok(Task.reconstitute(this.toProps(row)));
  }

  async findBySliceId(sliceId: Id): Promise<Result<Task[], PersistenceError>> {
    const rows = this.db
      .prepare<[string], TaskRow>("SELECT * FROM tasks WHERE slice_id = ?")
      .all(sliceId);
    return ok(rows.map((row) => Task.reconstitute(this.toProps(row))));
  }

  reset(): void {
    this.db.exec("DELETE FROM tasks");
  }

  private toProps(row: TaskRow): TaskProps {
    return {
      id: row.id,
      sliceId: row.slice_id,
      label: row.label,
      title: row.title,
      description: row.description,
      acceptanceCriteria: row.acceptance_criteria,
      filePaths: JSON.parse(row.file_paths),
      status: row.status as TaskStatus,
      blockedBy: JSON.parse(row.blocked_by),
      waveIndex: row.wave_index,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

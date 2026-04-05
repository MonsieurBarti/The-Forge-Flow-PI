import type { AutonomyMode } from "@hexagons/settings";
import { err, type Id, ok, PersistenceError, type Result } from "@kernel";
import type Database from "better-sqlite3";
import { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import { WorkflowSession } from "../domain/workflow-session.aggregate";
import type {
  EscalationProps,
  WorkflowPhase,
  WorkflowSessionProps,
} from "../domain/workflow-session.schemas";

interface WorkflowSessionRow {
  id: string;
  milestone_id: string;
  slice_id: string | null;
  current_phase: string;
  previous_phase: string | null;
  retry_count: number;
  autonomy_mode: string;
  created_at: string;
  updated_at: string;
  last_escalation: string | null;
}

export class SqliteWorkflowSessionRepository extends WorkflowSessionRepositoryPort {
  constructor(private readonly db: Database.Database) {
    super();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_sessions (
        id              TEXT NOT NULL PRIMARY KEY,
        milestone_id    TEXT NOT NULL,
        slice_id        TEXT,
        current_phase   TEXT NOT NULL,
        previous_phase  TEXT,
        retry_count     INTEGER NOT NULL DEFAULT 0,
        autonomy_mode   TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        last_escalation TEXT
      )
    `);
  }

  async save(session: WorkflowSession): Promise<Result<void, PersistenceError>> {
    const props = session.toJSON();

    const conflict = this.db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM workflow_sessions WHERE milestone_id = ? AND id != ?",
      )
      .get(props.milestoneId, props.id);

    if (conflict) {
      return err(
        new PersistenceError(
          `Milestone cardinality violated: session for milestone "${props.milestoneId}" already exists`,
        ),
      );
    }

    this.db
      .prepare(
        `INSERT OR REPLACE INTO workflow_sessions
         (id, milestone_id, slice_id, current_phase, previous_phase, retry_count, autonomy_mode, created_at, updated_at, last_escalation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        props.id,
        props.milestoneId,
        props.sliceId ?? null,
        props.currentPhase,
        props.previousPhase ?? null,
        props.retryCount,
        props.autonomyMode,
        props.createdAt.toISOString(),
        props.updatedAt.toISOString(),
        props.lastEscalation ? JSON.stringify(props.lastEscalation) : null,
      );

    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<WorkflowSession | null, PersistenceError>> {
    const row = this.db
      .prepare<[string], WorkflowSessionRow>("SELECT * FROM workflow_sessions WHERE id = ?")
      .get(id);
    if (!row) return ok(null);
    return ok(WorkflowSession.reconstitute(this.toProps(row)));
  }

  async findByMilestoneId(
    milestoneId: Id,
  ): Promise<Result<WorkflowSession | null, PersistenceError>> {
    const row = this.db
      .prepare<[string], WorkflowSessionRow>(
        "SELECT * FROM workflow_sessions WHERE milestone_id = ?",
      )
      .get(milestoneId);
    if (!row) return ok(null);
    return ok(WorkflowSession.reconstitute(this.toProps(row)));
  }

  async findAll(): Promise<Result<WorkflowSession[], PersistenceError>> {
    const rows = this.db.prepare("SELECT * FROM workflow_sessions").all() as WorkflowSessionRow[];
    return ok(rows.map((row) => WorkflowSession.reconstitute(this.toProps(row))));
  }

  reset(): void {
    this.db.exec("DELETE FROM workflow_sessions");
  }

  private toProps(row: WorkflowSessionRow): WorkflowSessionProps {
    return {
      id: row.id,
      milestoneId: row.milestone_id,
      sliceId: row.slice_id ?? undefined,
      currentPhase: row.current_phase as WorkflowPhase,
      previousPhase: (row.previous_phase as WorkflowPhase) ?? undefined,
      retryCount: row.retry_count,
      autonomyMode: row.autonomy_mode as AutonomyMode,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastEscalation: row.last_escalation
        ? (JSON.parse(row.last_escalation) as EscalationProps)
        : null,
    };
  }
}

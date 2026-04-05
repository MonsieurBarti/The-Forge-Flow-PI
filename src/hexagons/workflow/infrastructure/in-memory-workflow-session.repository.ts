import { err, type Id, ok, PersistenceError, type Result } from "@kernel";
import { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import { WorkflowSession } from "../domain/workflow-session.aggregate";
import type { WorkflowSessionProps } from "../domain/workflow-session.schemas";

export class InMemoryWorkflowSessionRepository extends WorkflowSessionRepositoryPort {
  private store = new Map<string, WorkflowSessionProps>();

  async save(session: WorkflowSession): Promise<Result<void, PersistenceError>> {
    const props = session.toJSON();
    for (const [existingId, existingProps] of this.store) {
      if (existingId !== props.id && existingProps.milestoneId === props.milestoneId) {
        return err(
          new PersistenceError(
            `Milestone cardinality violated: session for milestone "${props.milestoneId}" already exists`,
          ),
        );
      }
    }
    this.store.set(props.id, props);
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<WorkflowSession | null, PersistenceError>> {
    const props = this.store.get(id);
    if (!props) return ok(null);
    return ok(WorkflowSession.reconstitute(props));
  }

  async findByMilestoneId(
    milestoneId: Id,
  ): Promise<Result<WorkflowSession | null, PersistenceError>> {
    for (const props of this.store.values()) {
      if (props.milestoneId === milestoneId) {
        return ok(WorkflowSession.reconstitute(props));
      }
    }
    return ok(null);
  }

  async findAll(): Promise<Result<WorkflowSession[], PersistenceError>> {
    return ok(Array.from(this.store.values()).map((p) => WorkflowSession.reconstitute(p)));
  }

  seed(session: WorkflowSession): void {
    this.store.set(session.id, session.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

import type { Id, PersistenceError, Result } from "@kernel";
import type { WorkflowSession } from "../workflow-session.aggregate";

export abstract class WorkflowSessionRepositoryPort {
  abstract save(session: WorkflowSession): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<WorkflowSession | null, PersistenceError>>;
  abstract findByMilestoneId(
    milestoneId: Id,
  ): Promise<Result<WorkflowSession | null, PersistenceError>>;
  abstract findAll(): Promise<Result<WorkflowSession[], PersistenceError>>;
  abstract reset(): void;
}

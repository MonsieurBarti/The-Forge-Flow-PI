import type { Id, PersistenceError, Result } from "@kernel";
import type { Milestone } from "../milestone.aggregate";

export abstract class MilestoneRepositoryPort {
  abstract save(milestone: Milestone): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Milestone | null, PersistenceError>>;
  abstract findByLabel(label: string): Promise<Result<Milestone | null, PersistenceError>>;
  abstract findByProjectId(projectId: Id): Promise<Result<Milestone[], PersistenceError>>;
  abstract reset(): void;
}

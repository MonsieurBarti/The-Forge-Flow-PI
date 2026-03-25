import type { Id, PersistenceError, Result } from "@kernel";
import type { Milestone } from "../domain/milestone.aggregate";
import { MilestoneRepositoryPort } from "../domain/ports/milestone-repository.port";

export class SqliteMilestoneRepository extends MilestoneRepositoryPort {
  save(_milestone: Milestone): Promise<Result<void, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findById(_id: Id): Promise<Result<Milestone | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findByLabel(_label: string): Promise<Result<Milestone | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findByProjectId(_projectId: Id): Promise<Result<Milestone[], PersistenceError>> {
    throw new Error("Not implemented");
  }
}

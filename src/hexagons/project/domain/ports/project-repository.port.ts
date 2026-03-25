import type { Id, PersistenceError, Result } from "@kernel";
import type { Project } from "../project.aggregate";

export abstract class ProjectRepositoryPort {
  abstract save(project: Project): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Project | null, PersistenceError>>;
  abstract findSingleton(): Promise<Result<Project | null, PersistenceError>>;
}

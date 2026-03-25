import type { Id, PersistenceError, Result } from "@kernel";
import { ProjectRepositoryPort } from "../domain/ports/project-repository.port";
import type { Project } from "../domain/project.aggregate";

export class SqliteProjectRepository extends ProjectRepositoryPort {
  save(_project: Project): Promise<Result<void, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findById(_id: Id): Promise<Result<Project | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findSingleton(): Promise<Result<Project | null, PersistenceError>> {
    throw new Error("Not implemented");
  }
}

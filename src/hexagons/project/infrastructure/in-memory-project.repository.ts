import { err, type Id, ok, PersistenceError, type Result } from "@kernel";
import { Project } from "../domain/project.aggregate";
import type { ProjectProps } from "../domain/project.schemas";
import { ProjectRepositoryPort } from "../domain/project-repository.port";

export class InMemoryProjectRepository extends ProjectRepositoryPort {
  private store = new Map<string, ProjectProps>();

  async save(project: Project): Promise<Result<void, PersistenceError>> {
    const props = project.toJSON();
    for (const [existingId] of this.store) {
      if (existingId !== props.id) {
        return err(
          new PersistenceError("Project singleton violated: a different project already exists"),
        );
      }
    }
    this.store.set(props.id, props);
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Project | null, PersistenceError>> {
    const props = this.store.get(id);
    if (!props) return ok(null);
    return ok(Project.reconstitute(props));
  }

  async findSingleton(): Promise<Result<Project | null, PersistenceError>> {
    const entries = [...this.store.values()];
    if (entries.length === 0) return ok(null);
    return ok(Project.reconstitute(entries[0]));
  }

  seed(project: Project): void {
    this.store.set(project.id, project.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

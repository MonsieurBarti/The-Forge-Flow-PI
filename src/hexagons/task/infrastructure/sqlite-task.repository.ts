import type { Id, PersistenceError, Result } from "@kernel";
import { TaskRepositoryPort } from "../domain/ports/task-repository.port";
import type { Task } from "../domain/task.aggregate";

export class SqliteTaskRepository extends TaskRepositoryPort {
  save(_task: Task): Promise<Result<void, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findById(_id: Id): Promise<Result<Task | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findByLabel(_label: string): Promise<Result<Task | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findBySliceId(_sliceId: Id): Promise<Result<Task[], PersistenceError>> {
    throw new Error("Not implemented");
  }
}

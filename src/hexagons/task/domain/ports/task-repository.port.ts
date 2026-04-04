import type { Id, PersistenceError, Result } from "@kernel";
import type { Task } from "../task.aggregate";

export abstract class TaskRepositoryPort {
  abstract save(task: Task): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Task | null, PersistenceError>>;
  abstract findByLabel(label: string): Promise<Result<Task | null, PersistenceError>>;
  abstract findBySliceId(sliceId: Id): Promise<Result<Task[], PersistenceError>>;
  abstract reset(): void;
}

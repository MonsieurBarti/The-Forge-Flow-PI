import { err, type Id, ok, PersistenceError, type Result } from "@kernel";
import { TaskRepositoryPort } from "../domain/ports/task-repository.port";
import { Task } from "../domain/task.aggregate";
import type { TaskProps } from "../domain/task.schemas";

export class InMemoryTaskRepository extends TaskRepositoryPort {
  private store = new Map<string, TaskProps>();

  async save(task: Task): Promise<Result<void, PersistenceError>> {
    const props = task.toJSON();
    for (const [existingId, existingProps] of this.store) {
      if (
        existingId !== props.id &&
        existingProps.label === props.label &&
        existingProps.sliceId === props.sliceId
      ) {
        return err(
          new PersistenceError(
            `Label uniqueness violated: task '${props.label}' already exists in slice '${props.sliceId}'`,
          ),
        );
      }
    }
    this.store.set(props.id, props);
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Task | null, PersistenceError>> {
    const props = this.store.get(id);
    if (!props) return ok(null);
    return ok(Task.reconstitute(props));
  }

  async findByLabel(label: string): Promise<Result<Task | null, PersistenceError>> {
    for (const props of this.store.values()) {
      if (props.label === label) {
        return ok(Task.reconstitute(props));
      }
    }
    return ok(null);
  }

  async findBySliceId(sliceId: Id): Promise<Result<Task[], PersistenceError>> {
    const results: Task[] = [];
    for (const props of this.store.values()) {
      if (props.sliceId === sliceId) {
        results.push(Task.reconstitute(props));
      }
    }
    return ok(results);
  }

  seed(task: Task): void {
    this.store.set(task.id, task.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

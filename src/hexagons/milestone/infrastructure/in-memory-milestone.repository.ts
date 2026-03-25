import { err, type Id, ok, PersistenceError, type Result } from "@kernel";
import { Milestone } from "../domain/milestone.aggregate";
import type { MilestoneProps } from "../domain/milestone.schemas";
import { MilestoneRepositoryPort } from "../domain/ports/milestone-repository.port";

export class InMemoryMilestoneRepository extends MilestoneRepositoryPort {
  private store = new Map<string, MilestoneProps>();

  async save(milestone: Milestone): Promise<Result<void, PersistenceError>> {
    const props = milestone.toJSON();
    for (const [existingId, existingProps] of this.store) {
      if (existingId !== props.id && existingProps.label === props.label) {
        return err(
          new PersistenceError(
            `Label uniqueness violated: milestone '${props.label}' already exists`,
          ),
        );
      }
    }
    this.store.set(props.id, props);
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Milestone | null, PersistenceError>> {
    const props = this.store.get(id);
    if (!props) return ok(null);
    return ok(Milestone.reconstitute(props));
  }

  async findByLabel(label: string): Promise<Result<Milestone | null, PersistenceError>> {
    for (const props of this.store.values()) {
      if (props.label === label) {
        return ok(Milestone.reconstitute(props));
      }
    }
    return ok(null);
  }

  async findByProjectId(projectId: Id): Promise<Result<Milestone[], PersistenceError>> {
    const results: Milestone[] = [];
    for (const props of this.store.values()) {
      if (props.projectId === projectId) {
        results.push(Milestone.reconstitute(props));
      }
    }
    return ok(results);
  }

  seed(milestone: Milestone): void {
    this.store.set(milestone.id, milestone.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

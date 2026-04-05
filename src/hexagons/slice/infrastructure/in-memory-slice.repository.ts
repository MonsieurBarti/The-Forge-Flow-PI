import { err, type Id, ok, PersistenceError, type Result } from "@kernel";
import { SliceRepositoryPort } from "../domain/ports/slice-repository.port";
import { Slice } from "../domain/slice.aggregate";
import type { SliceKind, SliceProps } from "../domain/slice.schemas";

export class InMemorySliceRepository extends SliceRepositoryPort {
  private store = new Map<string, SliceProps>();

  async save(slice: Slice): Promise<Result<void, PersistenceError>> {
    const props = slice.toJSON();
    for (const [existingId, existingProps] of this.store) {
      if (existingId !== props.id && existingProps.label === props.label) {
        return err(
          new PersistenceError(`Label uniqueness violated: slice '${props.label}' already exists`),
        );
      }
    }
    this.store.set(props.id, props);
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Slice | null, PersistenceError>> {
    const props = this.store.get(id);
    if (!props) return ok(null);
    return ok(Slice.reconstitute(props));
  }

  async findByLabel(label: string): Promise<Result<Slice | null, PersistenceError>> {
    for (const props of this.store.values()) {
      if (props.label === label) {
        return ok(Slice.reconstitute(props));
      }
    }
    return ok(null);
  }

  async findByMilestoneId(milestoneId: Id): Promise<Result<Slice[], PersistenceError>> {
    const results: Slice[] = [];
    for (const props of this.store.values()) {
      if (props.milestoneId === milestoneId) {
        results.push(Slice.reconstitute(props));
      }
    }
    return ok(results);
  }

  async findByKind(kind: SliceKind): Promise<Result<Slice[], PersistenceError>> {
    const matches = [...this.store.values()]
      .filter((props) => props.kind === kind)
      .map((props) => Slice.reconstitute(props));
    return ok(matches);
  }

  seed(slice: Slice): void {
    this.store.set(slice.id, slice.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

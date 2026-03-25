import type { Id, PersistenceError, Result } from "@kernel";
import type { Slice } from "../slice.aggregate";

export abstract class SliceRepositoryPort {
  abstract save(slice: Slice): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Slice | null, PersistenceError>>;
  abstract findByLabel(label: string): Promise<Result<Slice | null, PersistenceError>>;
  abstract findByMilestoneId(milestoneId: Id): Promise<Result<Slice[], PersistenceError>>;
}

import type { Id, PersistenceError, Result } from "@kernel";
import type { Slice } from "../domain/slice.aggregate";
import { SliceRepositoryPort } from "../domain/slice-repository.port";

export class SqliteSliceRepository extends SliceRepositoryPort {
  save(_slice: Slice): Promise<Result<void, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findById(_id: Id): Promise<Result<Slice | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findByLabel(_label: string): Promise<Result<Slice | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findByMilestoneId(_milestoneId: Id): Promise<Result<Slice[], PersistenceError>> {
    throw new Error("Not implemented");
  }
}

import type { Id, PersistenceError, Result } from "@kernel";
import type { ShipRecord } from "../ship-record.aggregate";

export abstract class ShipRecordRepositoryPort {
  abstract save(record: ShipRecord): Promise<Result<void, PersistenceError>>;
  abstract findBySliceId(sliceId: Id): Promise<Result<ShipRecord[], PersistenceError>>;
}

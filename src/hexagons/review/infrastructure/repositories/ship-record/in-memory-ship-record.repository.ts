import { type Id, ok, type PersistenceError, type Result } from "@kernel";
import { ShipRecord } from "../../../domain/aggregates/ship-record.aggregate";
import { ShipRecordRepositoryPort } from "../../../domain/ports/ship-record-repository.port";
import type { ShipRecordProps } from "../../../domain/schemas/ship.schemas";

export class InMemoryShipRecordRepository extends ShipRecordRepositoryPort {
  private store = new Map<string, ShipRecordProps>();

  async save(record: ShipRecord): Promise<Result<void, PersistenceError>> {
    this.store.set(record.id, record.toJSON());
    return ok(undefined);
  }

  async findBySliceId(sliceId: Id): Promise<Result<ShipRecord[], PersistenceError>> {
    const records: ShipRecord[] = [];
    for (const props of this.store.values()) {
      if (props.sliceId === sliceId) {
        records.push(ShipRecord.reconstitute(props));
      }
    }
    return ok(records);
  }

  async findAll(): Promise<Result<ShipRecord[], PersistenceError>> {
    return ok(Array.from(this.store.values()).map((props) => ShipRecord.reconstitute(props)));
  }

  seed(record: ShipRecord): void {
    this.store.set(record.id, record.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

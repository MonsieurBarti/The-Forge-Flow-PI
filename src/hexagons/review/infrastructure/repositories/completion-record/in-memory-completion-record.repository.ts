import { ok, type PersistenceError, type Result } from "@kernel";
import { CompletionRecord } from "../../../domain/aggregates/completion-record.aggregate";
import { CompletionRecordRepositoryPort } from "../../../domain/ports/completion-record-repository.port";
import type { CompletionRecordProps } from "../../../domain/schemas/completion.schemas";

export class InMemoryCompletionRecordRepository extends CompletionRecordRepositoryPort {
  private store = new Map<string, CompletionRecordProps>();

  async save(record: CompletionRecord): Promise<Result<void, PersistenceError>> {
    this.store.set(record.id, record.toJSON());
    return ok(undefined);
  }

  async findByMilestoneId(
    milestoneId: string,
  ): Promise<Result<CompletionRecord | null, PersistenceError>> {
    for (const props of this.store.values()) {
      if (props.milestoneId === milestoneId) {
        return ok(CompletionRecord.reconstitute(props));
      }
    }
    return ok(null);
  }

  async findAll(): Promise<Result<CompletionRecord[], PersistenceError>> {
    return ok(Array.from(this.store.values()).map((props) => CompletionRecord.reconstitute(props)));
  }

  seed(record: CompletionRecord): void {
    this.store.set(record.id, record.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

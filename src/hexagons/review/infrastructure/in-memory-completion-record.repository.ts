import { ok, type PersistenceError, type Result } from "@kernel";
import type { CompletionRecordProps } from "../domain/completion.schemas";
import { CompletionRecord } from "../domain/completion-record.aggregate";
import { CompletionRecordRepositoryPort } from "../domain/ports/completion-record-repository.port";

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

  seed(record: CompletionRecord): void {
    this.store.set(record.id, record.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

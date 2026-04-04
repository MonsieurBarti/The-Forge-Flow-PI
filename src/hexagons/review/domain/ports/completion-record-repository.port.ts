import type { PersistenceError, Result } from "@kernel";
import type { CompletionRecord } from "../aggregates/completion-record.aggregate";

export abstract class CompletionRecordRepositoryPort {
  abstract save(record: CompletionRecord): Promise<Result<void, PersistenceError>>;
  abstract findByMilestoneId(
    milestoneId: string,
  ): Promise<Result<CompletionRecord | null, PersistenceError>>;
  abstract findAll(): Promise<Result<CompletionRecord[], PersistenceError>>;
}

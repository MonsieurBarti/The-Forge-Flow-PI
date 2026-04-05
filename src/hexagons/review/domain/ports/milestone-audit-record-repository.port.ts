import type { Id, PersistenceError, Result } from "@kernel";
import type { MilestoneAuditRecord } from "../aggregates/milestone-audit-record.aggregate";

export abstract class MilestoneAuditRecordRepositoryPort {
  abstract save(record: MilestoneAuditRecord): Promise<Result<void, PersistenceError>>;
  abstract findLatestByMilestoneId(
    milestoneId: Id,
  ): Promise<Result<MilestoneAuditRecord | null, PersistenceError>>;
  abstract reset(): void;
}

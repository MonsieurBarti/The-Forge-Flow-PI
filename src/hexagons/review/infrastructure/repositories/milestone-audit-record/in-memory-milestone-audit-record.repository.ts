import { type Id, ok, type PersistenceError, type Result } from "@kernel";
import { MilestoneAuditRecord } from "../../../domain/aggregates/milestone-audit-record.aggregate";
import { MilestoneAuditRecordRepositoryPort } from "../../../domain/ports/milestone-audit-record-repository.port";
import type { MilestoneAuditRecordProps } from "../../../domain/schemas/milestone-audit-record.schemas";

export class InMemoryMilestoneAuditRecordRepository extends MilestoneAuditRecordRepositoryPort {
  private store = new Map<string, MilestoneAuditRecordProps>();

  async save(record: MilestoneAuditRecord): Promise<Result<void, PersistenceError>> {
    this.store.set(record.id, record.toJSON());
    return ok(undefined);
  }

  async findLatestByMilestoneId(
    milestoneId: Id,
  ): Promise<Result<MilestoneAuditRecord | null, PersistenceError>> {
    let latest: MilestoneAuditRecordProps | null = null;
    for (const props of this.store.values()) {
      if (props.milestoneId === milestoneId) {
        if (!latest || props.auditedAt > latest.auditedAt) {
          latest = props;
        }
      }
    }
    if (!latest) return ok(null);
    return ok(MilestoneAuditRecord.reconstitute(latest));
  }

  reset(): void {
    this.store.clear();
  }
}

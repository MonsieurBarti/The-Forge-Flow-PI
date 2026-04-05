import { AggregateRoot } from "@kernel";
import type { AuditReportProps } from "../schemas/completion.schemas";
import type { MilestoneAuditRecordProps } from "../schemas/milestone-audit-record.schemas";
import { MilestoneAuditRecordPropsSchema } from "../schemas/milestone-audit-record.schemas";

export class MilestoneAuditRecord extends AggregateRoot<MilestoneAuditRecordProps> {
  private constructor(props: MilestoneAuditRecordProps) {
    super(props, MilestoneAuditRecordPropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get milestoneId(): string {
    return this.props.milestoneId;
  }

  get milestoneLabel(): string {
    return this.props.milestoneLabel;
  }

  get auditReports(): AuditReportProps[] {
    return this.props.auditReports;
  }

  get allPassed(): boolean {
    return this.props.allPassed;
  }

  get unresolvedCount(): number {
    return this.props.unresolvedCount;
  }

  get auditedAt(): Date {
    return this.props.auditedAt;
  }

  static createNew(params: {
    id: string;
    milestoneId: string;
    milestoneLabel: string;
    auditReports: AuditReportProps[];
    now: Date;
  }): MilestoneAuditRecord {
    const unresolvedCount = params.auditReports.reduce((sum, r) => sum + r.findings.length, 0);
    const allPassed = params.auditReports.every((r) => r.verdict === "PASS");

    return new MilestoneAuditRecord({
      id: params.id,
      milestoneId: params.milestoneId,
      milestoneLabel: params.milestoneLabel,
      auditReports: params.auditReports,
      allPassed,
      unresolvedCount,
      auditedAt: params.now,
    });
  }

  static reconstitute(props: MilestoneAuditRecordProps): MilestoneAuditRecord {
    return new MilestoneAuditRecord(props);
  }
}

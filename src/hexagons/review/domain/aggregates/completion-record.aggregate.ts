import { AggregateRoot } from "@kernel";
import type { AuditReportProps, CompletionRecordProps } from "../schemas/completion.schemas";
import { CompletionRecordPropsSchema } from "../schemas/completion.schemas";

export class CompletionRecord extends AggregateRoot<CompletionRecordProps> {
  private constructor(props: CompletionRecordProps) {
    super(props, CompletionRecordPropsSchema);
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

  get prNumber(): number {
    return this.props.prNumber;
  }

  get prUrl(): string {
    return this.props.prUrl;
  }

  get headBranch(): string {
    return this.props.headBranch;
  }

  get baseBranch(): string {
    return this.props.baseBranch;
  }

  get auditReports(): AuditReportProps[] {
    return this.props.auditReports;
  }

  get isMerged(): boolean {
    return this.props.outcome === "merged";
  }

  get isAborted(): boolean {
    return this.props.outcome === "abort";
  }

  static createNew(params: {
    id: string;
    milestoneId: string;
    milestoneLabel: string;
    prNumber: number;
    prUrl: string;
    headBranch: string;
    baseBranch: string;
    auditReports: AuditReportProps[];
    now: Date;
  }): CompletionRecord {
    return new CompletionRecord({
      id: params.id,
      milestoneId: params.milestoneId,
      milestoneLabel: params.milestoneLabel,
      prNumber: params.prNumber,
      prUrl: params.prUrl,
      headBranch: params.headBranch,
      baseBranch: params.baseBranch,
      auditReports: params.auditReports,
      outcome: null,
      fixCyclesUsed: 0,
      createdAt: params.now,
      completedAt: null,
    });
  }

  static reconstitute(props: CompletionRecordProps): CompletionRecord {
    return new CompletionRecord(props);
  }

  recordMerge(fixCyclesUsed: number, now: Date): void {
    if (this.props.outcome !== null) {
      throw new Error(`Cannot recordMerge: outcome already set to "${this.props.outcome}"`);
    }
    this.props.outcome = "merged";
    this.props.fixCyclesUsed = fixCyclesUsed;
    this.props.completedAt = now;
  }

  recordAbort(now: Date): void {
    if (this.props.outcome !== null) {
      throw new Error(`Cannot recordAbort: outcome already set to "${this.props.outcome}"`);
    }
    this.props.outcome = "abort";
    this.props.completedAt = now;
  }
}

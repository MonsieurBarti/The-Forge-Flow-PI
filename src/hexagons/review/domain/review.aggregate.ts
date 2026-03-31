import { AggregateRoot, type BaseDomainError, ok, type Result } from "@kernel";
import { ReviewRecordedEvent } from "./events/review-recorded.event";
import {
  type FindingProps,
  type ReviewProps,
  ReviewPropsSchema,
  type ReviewRole,
  type ReviewVerdict,
} from "./review.schemas";

export class Review extends AggregateRoot<ReviewProps> {
  private constructor(props: ReviewProps) {
    super(props, ReviewPropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get sliceId(): string {
    return this.props.sliceId;
  }

  get role(): ReviewRole {
    return this.props.role;
  }

  get agentIdentity(): string {
    return this.props.agentIdentity;
  }

  get verdict(): ReviewVerdict {
    return this.props.verdict;
  }

  get findings(): ReadonlyArray<FindingProps> {
    return this.props.findings;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  static createNew(params: {
    id: string;
    sliceId: string;
    role: ReviewRole;
    agentIdentity: string;
    now: Date;
  }): Review {
    const review = new Review({
      id: params.id,
      sliceId: params.sliceId,
      role: params.role,
      agentIdentity: params.agentIdentity,
      verdict: "approved",
      findings: [],
      createdAt: params.now,
      updatedAt: params.now,
    });
    review.addEvent(
      new ReviewRecordedEvent({
        id: crypto.randomUUID(),
        aggregateId: params.id,
        occurredAt: params.now,
        sliceId: params.sliceId,
        role: params.role,
        verdict: "approved",
        findingsCount: 0,
        blockerCount: 0,
      }),
    );
    return review;
  }

  static reconstitute(props: ReviewProps): Review {
    return new Review(props);
  }

  recordFindings(findings: FindingProps[], now: Date): Result<void, BaseDomainError> {
    this.props.findings = [...findings];
    this.props.verdict = this.computeVerdict();
    this.props.updatedAt = now;
    this.addEvent(
      new ReviewRecordedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        sliceId: this.props.sliceId,
        role: this.props.role,
        verdict: this.props.verdict,
        findingsCount: findings.length,
        blockerCount: this.getBlockerCount(),
      }),
    );
    return ok(undefined);
  }

  computeVerdict(): ReviewVerdict {
    const hasBlocker = this.props.findings.some(
      (f) => f.severity === "critical" || f.severity === "high",
    );
    return hasBlocker ? "changes_requested" : "approved";
  }

  getBlockerCount(): number {
    return this.props.findings.filter((f) => f.severity === "critical" || f.severity === "high")
      .length;
  }

  getAdvisoryCount(): number {
    return this.props.findings.filter(
      (f) => f.severity === "medium" || f.severity === "low" || f.severity === "info",
    ).length;
  }
}

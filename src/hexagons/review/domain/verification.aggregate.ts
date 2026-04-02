import { AggregateRoot } from "@kernel";
import type {
  CriterionVerdictProps,
  VerificationProps,
  VerificationVerdict,
} from "./verification.schemas";
import { VerificationPropsSchema } from "./verification.schemas";

export class Verification extends AggregateRoot<VerificationProps> {
  private constructor(props: VerificationProps) {
    super(props, VerificationPropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get sliceId(): string {
    return this.props.sliceId;
  }

  get agentIdentity(): string {
    return this.props.agentIdentity;
  }

  get criteria(): ReadonlyArray<CriterionVerdictProps> {
    return this.props.criteria;
  }

  get overallVerdict(): VerificationVerdict {
    return this.props.overallVerdict;
  }

  get fixCycleIndex(): number {
    return this.props.fixCycleIndex;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get passCount(): number {
    return this.props.criteria.filter((c) => c.verdict === "PASS").length;
  }

  get failCount(): number {
    return this.props.criteria.filter((c) => c.verdict === "FAIL").length;
  }

  static createNew(params: {
    id: string;
    sliceId: string;
    agentIdentity: string;
    fixCycleIndex: number;
    now: Date;
  }): Verification {
    return new Verification({
      id: params.id,
      sliceId: params.sliceId,
      agentIdentity: params.agentIdentity,
      criteria: [],
      overallVerdict: "PASS",
      fixCycleIndex: params.fixCycleIndex,
      createdAt: params.now,
    });
  }

  static reconstitute(props: VerificationProps): Verification {
    return new Verification(props);
  }

  recordCriteria(criteria: CriterionVerdictProps[]): void {
    this.props.criteria = [...criteria];
    this.props.overallVerdict =
      criteria.length > 0 && criteria.every((c) => c.verdict === "PASS") ? "PASS" : "FAIL";
  }
}

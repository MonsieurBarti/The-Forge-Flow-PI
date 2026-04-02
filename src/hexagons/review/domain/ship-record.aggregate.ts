import { AggregateRoot } from "@kernel";
import type { ShipRecordProps } from "./ship.schemas";
import { ShipRecordPropsSchema } from "./ship.schemas";

export class ShipRecord extends AggregateRoot<ShipRecordProps> {
  private constructor(props: ShipRecordProps) {
    super(props, ShipRecordPropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get sliceId(): string {
    return this.props.sliceId;
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

  get isMerged(): boolean {
    return this.props.outcome === "merged";
  }

  get isAborted(): boolean {
    return this.props.outcome === "abort";
  }

  static createNew(params: {
    id: string;
    sliceId: string;
    prNumber: number;
    prUrl: string;
    headBranch: string;
    baseBranch: string;
    now: Date;
  }): ShipRecord {
    return new ShipRecord({
      id: params.id,
      sliceId: params.sliceId,
      prNumber: params.prNumber,
      prUrl: params.prUrl,
      headBranch: params.headBranch,
      baseBranch: params.baseBranch,
      outcome: null,
      fixCyclesUsed: 0,
      createdAt: params.now,
      completedAt: null,
    });
  }

  static reconstitute(props: ShipRecordProps): ShipRecord {
    return new ShipRecord(props);
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

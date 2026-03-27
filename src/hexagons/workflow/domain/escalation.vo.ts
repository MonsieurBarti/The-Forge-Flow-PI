import { ValueObject } from "@kernel";
import {
  type EscalationProps,
  EscalationPropsSchema,
  type WorkflowPhase,
} from "./workflow-session.schemas";

export class Escalation extends ValueObject<EscalationProps> {
  private constructor(props: EscalationProps) {
    super(props, EscalationPropsSchema);
  }

  static create(props: EscalationProps): Escalation {
    return new Escalation(props);
  }

  static fromRetryExhaustion(
    sliceId: string,
    phase: WorkflowPhase,
    retryCount: number,
    lastError: string | null,
  ): Escalation {
    return new Escalation({
      sliceId,
      phase,
      reason: `Retries exhausted at ${phase}`,
      attempts: retryCount,
      lastError,
      occurredAt: new Date(),
    });
  }

  get sliceId(): string {
    return this.props.sliceId;
  }

  get phase(): WorkflowPhase {
    return this.props.phase;
  }

  get reason(): string {
    return this.props.reason;
  }

  get attempts(): number {
    return this.props.attempts;
  }

  get lastError(): string | null {
    return this.props.lastError;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }

  get toProps(): EscalationProps {
    return { ...this.props };
  }

  get summary(): string {
    return `Slice ${this.props.sliceId}: blocked at ${this.props.phase} after ${this.props.attempts} attempts`;
  }
}

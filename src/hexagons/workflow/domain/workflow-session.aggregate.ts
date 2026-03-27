import type { AutonomyMode } from "@hexagons/settings";
import { AggregateRoot, err, ok, type Result } from "@kernel";
import { GuardRejectedError } from "./errors/guard-rejected.error";
import { NoMatchingTransitionError } from "./errors/no-matching-transition.error";
import { SliceAlreadyAssignedError } from "./errors/slice-already-assigned.error";
import type { WorkflowBaseError } from "./errors/workflow-base.error";
import { WorkflowPhaseChangedEvent } from "./events/workflow-phase-changed.event";
import { evaluateGuard, findMatchingRules } from "./transition-table";
import type {
  GuardContext,
  GuardName,
  TransitionEffect,
  TransitionRule,
  WorkflowPhase,
  WorkflowSessionProps,
  WorkflowTrigger,
} from "./workflow-session.schemas";
import { WorkflowSessionPropsSchema } from "./workflow-session.schemas";

export class WorkflowSession extends AggregateRoot<WorkflowSessionProps> {
  private constructor(props: WorkflowSessionProps) {
    super(props, WorkflowSessionPropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get milestoneId(): string {
    return this.props.milestoneId;
  }

  get sliceId(): string | undefined {
    return this.props.sliceId;
  }

  get currentPhase(): WorkflowPhase {
    return this.props.currentPhase;
  }

  get previousPhase(): WorkflowPhase | undefined {
    return this.props.previousPhase;
  }

  get retryCount(): number {
    return this.props.retryCount;
  }

  get autonomyMode(): AutonomyMode {
    return this.props.autonomyMode;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  static createNew(params: {
    id: string;
    milestoneId: string;
    autonomyMode: "guided" | "plan-to-pr";
    now: Date;
  }): WorkflowSession {
    return new WorkflowSession({
      id: params.id,
      milestoneId: params.milestoneId,
      currentPhase: "idle",
      retryCount: 0,
      autonomyMode: params.autonomyMode,
      createdAt: params.now,
      updatedAt: params.now,
      lastEscalation: null,
    });
  }

  static reconstitute(props: WorkflowSessionProps): WorkflowSession {
    return new WorkflowSession(props);
  }

  trigger(trigger: WorkflowTrigger, ctx: GuardContext, now: Date): Result<void, WorkflowBaseError> {
    const fromPhase = this.props.currentPhase;
    const matchingRules = findMatchingRules(fromPhase, trigger);

    if (matchingRules.length === 0) {
      return err(new NoMatchingTransitionError(fromPhase, trigger));
    }

    const failedGuards: GuardName[] = [];
    for (const rule of matchingRules) {
      if (rule.guard && !evaluateGuard(rule.guard, ctx)) {
        failedGuards.push(rule.guard);
        continue;
      }
      return this.applyTransition(rule, fromPhase, trigger, now);
    }

    return err(new GuardRejectedError(fromPhase, trigger, failedGuards));
  }

  assignSlice(sliceId: string): Result<void, SliceAlreadyAssignedError> {
    if (this.props.sliceId) {
      return err(new SliceAlreadyAssignedError(this.props.sliceId));
    }
    this.props.sliceId = sliceId;
    return ok(undefined);
  }

  clearSlice(): void {
    this.props.sliceId = undefined;
    this.props.retryCount = 0;
  }

  private resolveTargetPhase(rule: TransitionRule, fromPhase: WorkflowPhase): WorkflowPhase {
    if (rule.to === "*previousPhase*") {
      return this.props.previousPhase ?? fromPhase;
    }
    return rule.to;
  }

  private applyTransition(
    rule: TransitionRule,
    fromPhase: WorkflowPhase,
    trigger: WorkflowTrigger,
    now: Date,
  ): Result<void, WorkflowBaseError> {
    for (const effect of rule.effects) {
      this.applyEffect(effect);
    }

    const toPhase = this.resolveTargetPhase(rule, fromPhase);

    this.props.currentPhase = toPhase;
    this.props.updatedAt = now;

    this.addEvent(
      new WorkflowPhaseChangedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        milestoneId: this.props.milestoneId,
        sliceId: this.props.sliceId,
        fromPhase,
        toPhase,
        trigger,
        retryCount: this.props.retryCount,
      }),
    );

    return ok(undefined);
  }

  private applyEffect(effect: TransitionEffect): void {
    switch (effect) {
      case "incrementRetry":
        this.props.retryCount++;
        break;
      case "savePreviousPhase":
        this.props.previousPhase = this.props.currentPhase;
        break;
      case "restorePreviousPhase":
        // target phase resolution handled by resolveTargetPhase
        break;
      case "resetRetryCount":
        this.props.retryCount = 0;
        break;
      case "clearSlice":
        this.props.sliceId = undefined;
        break;
    }
  }
}

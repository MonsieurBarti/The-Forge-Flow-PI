import { AggregateRoot, type Id, type InvalidTransitionError, ok, type Result } from "@kernel";
import { SliceCreatedEvent } from "./events/slice-created.event";
import { SliceStatusChangedEvent } from "./events/slice-status-changed.event";
import {
  type ComplexityCriteria,
  type ComplexityTier,
  classifyComplexity,
  type SliceKind,
  type SliceProps,
  SlicePropsSchema,
  type SliceStatus,
} from "./slice.schemas";
import { SliceStatusVO } from "./slice-status.vo";

export class Slice extends AggregateRoot<SliceProps> {
  private constructor(props: SliceProps) {
    super(props, SlicePropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get milestoneId(): string | null {
    return this.props.milestoneId;
  }

  get kind(): SliceKind {
    return this.props.kind;
  }

  get label(): string {
    return this.props.label;
  }

  get title(): string {
    return this.props.title;
  }

  get description(): string {
    return this.props.description;
  }

  get status(): SliceStatus {
    return this.props.status;
  }

  get complexity(): ComplexityTier | null {
    return this.props.complexity;
  }

  get specPath(): string | null {
    return this.props.specPath;
  }

  get planPath(): string | null {
    return this.props.planPath;
  }

  get researchPath(): string | null {
    return this.props.researchPath;
  }

  get position(): number {
    return this.props.position;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  static createNew(params: {
    id: Id;
    milestoneId?: Id;
    label: string;
    title: string;
    description?: string;
    kind?: SliceKind;
    position?: number;
    now: Date;
  }): Slice {
    const kind = params.kind ?? "milestone";
    const milestoneId = params.milestoneId ?? null;

    if (kind === "milestone" && milestoneId === null) {
      throw new Error("Milestone slice requires a milestoneId");
    }
    if (kind !== "milestone" && milestoneId !== null) {
      throw new Error(`Ad-hoc slice of kind "${kind}" must not have a milestoneId`);
    }

    const slice = new Slice({
      id: params.id,
      milestoneId,
      kind,
      label: params.label,
      title: params.title,
      description: params.description ?? "",
      status: "discussing",
      complexity: null,
      specPath: null,
      planPath: null,
      researchPath: null,
      position: params.position ?? 0,
      createdAt: params.now,
      updatedAt: params.now,
    });
    slice.addEvent(
      new SliceCreatedEvent({
        id: crypto.randomUUID(),
        aggregateId: params.id,
        occurredAt: params.now,
      }),
    );
    return slice;
  }

  transitionTo(target: SliceStatus, now: Date): Result<void, InvalidTransitionError> {
    const from = this.props.status;
    const currentVO = SliceStatusVO.create(from);
    const isSelfTransition = from === target;
    const result = currentVO.transitionTo(target);

    if (!result.ok) {
      return result;
    }

    this.props.status = result.data.value;
    this.props.updatedAt = now;

    if (!isSelfTransition) {
      this.addEvent(
        new SliceStatusChangedEvent({
          id: crypto.randomUUID(),
          aggregateId: this.props.id,
          occurredAt: now,
          from,
          to: target,
        }),
      );
    }

    return ok(undefined);
  }

  classify(criteria: ComplexityCriteria, now: Date): void {
    this.props.complexity = classifyComplexity(criteria);
    this.props.updatedAt = now;
  }

  setSpecPath(path: string, now: Date): void {
    this.props.specPath = path;
    this.props.updatedAt = now;
  }

  setComplexity(tier: ComplexityTier, now: Date): void {
    this.props.complexity = tier;
    this.props.updatedAt = now;
  }

  setResearchPath(path: string, now: Date): void {
    this.props.researchPath = path;
    this.props.updatedAt = now;
  }

  setPlanPath(path: string, now: Date): void {
    this.props.planPath = path;
    this.props.updatedAt = now;
  }

  static reconstitute(props: SliceProps): Slice {
    return new Slice(props);
  }
}

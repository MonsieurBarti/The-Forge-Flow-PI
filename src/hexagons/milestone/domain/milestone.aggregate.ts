import { AggregateRoot, err, type Id, InvalidTransitionError, ok, type Result } from "@kernel";
import { MilestoneClosedEvent } from "./events/milestone-closed.event";
import { MilestoneCreatedEvent } from "./events/milestone-created.event";
import {
  type MilestoneProps,
  MilestonePropsSchema,
  type MilestoneStatus,
} from "./milestone.schemas";

export class Milestone extends AggregateRoot<MilestoneProps> {
  private constructor(props: MilestoneProps) {
    super(props, MilestonePropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get projectId(): string {
    return this.props.projectId;
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

  get status(): MilestoneStatus {
    return this.props.status;
  }

  get branch(): string {
    return `milestone/${this.props.label}`;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  static createNew(params: {
    id: Id;
    projectId: Id;
    label: string;
    title: string;
    description?: string;
    now: Date;
  }): Milestone {
    const milestone = new Milestone({
      id: params.id,
      projectId: params.projectId,
      label: params.label,
      title: params.title,
      description: params.description ?? "",
      status: "open",
      createdAt: params.now,
      updatedAt: params.now,
    });
    milestone.addEvent(
      new MilestoneCreatedEvent({
        id: crypto.randomUUID(),
        aggregateId: params.id,
        occurredAt: params.now,
      }),
    );
    return milestone;
  }

  activate(now: Date): Result<void, InvalidTransitionError> {
    if (this.props.status !== "open") {
      return err(new InvalidTransitionError(this.props.status, "in_progress", "Milestone"));
    }
    this.props.status = "in_progress";
    this.props.updatedAt = now;
    return ok(undefined);
  }

  close(now: Date): Result<void, InvalidTransitionError> {
    if (this.props.status !== "in_progress") {
      return err(new InvalidTransitionError(this.props.status, "closed", "Milestone"));
    }
    this.props.status = "closed";
    this.props.updatedAt = now;
    this.addEvent(
      new MilestoneClosedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
      }),
    );
    return ok(undefined);
  }

  static reconstitute(props: MilestoneProps): Milestone {
    return new Milestone(props);
  }
}

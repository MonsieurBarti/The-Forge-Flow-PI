import { AggregateRoot, type Id, type InvalidTransitionError, type Result } from "@kernel";
import { TaskBlockedEvent } from "./events/task-blocked.event";
import { TaskCompletedEvent } from "./events/task-completed.event";
import { TaskCreatedEvent } from "./events/task-created.event";
import { type TaskProps, TaskPropsSchema, type TaskStatus } from "./task.schemas";
import { TaskStatusVO } from "./task-status.vo";

export class Task extends AggregateRoot<TaskProps> {
  private constructor(props: TaskProps) {
    super(props, TaskPropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get sliceId(): string {
    return this.props.sliceId;
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

  get acceptanceCriteria(): string {
    return this.props.acceptanceCriteria;
  }

  get filePaths(): readonly string[] {
    return this.props.filePaths;
  }

  get status(): TaskStatus {
    return this.props.status;
  }

  get blockedBy(): readonly string[] {
    return this.props.blockedBy;
  }

  get waveIndex(): number | null {
    return this.props.waveIndex;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  static createNew(params: {
    id: Id;
    sliceId: Id;
    label: string;
    title: string;
    description?: string;
    acceptanceCriteria?: string;
    filePaths?: string[];
    blockedBy?: string[];
    now: Date;
  }): Task {
    const task = new Task({
      id: params.id,
      sliceId: params.sliceId,
      label: params.label,
      title: params.title,
      description: params.description ?? "",
      acceptanceCriteria: params.acceptanceCriteria ?? "",
      filePaths: params.filePaths ?? [],
      status: "open",
      blockedBy: params.blockedBy ?? [],
      waveIndex: null,
      createdAt: params.now,
      updatedAt: params.now,
    });
    task.addEvent(
      new TaskCreatedEvent({
        id: crypto.randomUUID(),
        aggregateId: params.id,
        occurredAt: params.now,
      }),
    );
    return task;
  }

  start(now: Date): Result<void, InvalidTransitionError> {
    return this.applyTransition("in_progress", now);
  }

  complete(now: Date): Result<void, InvalidTransitionError> {
    const result = this.applyTransition("closed", now);
    if (result.ok) {
      this.addEvent(
        new TaskCompletedEvent({
          id: crypto.randomUUID(),
          aggregateId: this.props.id,
          occurredAt: now,
        }),
      );
    }
    return result;
  }

  block(blockerIds: string[], now: Date): Result<void, InvalidTransitionError> {
    const isSelfTransition = this.props.status === "blocked";
    const result = this.applyTransition("blocked", now);
    if (result.ok) {
      this.props.blockedBy = [...new Set([...this.props.blockedBy, ...blockerIds])];
      if (!isSelfTransition) {
        this.addEvent(
          new TaskBlockedEvent({
            id: crypto.randomUUID(),
            aggregateId: this.props.id,
            occurredAt: now,
          }),
        );
      }
    }
    return result;
  }

  unblock(blockerId: string, now: Date): Result<void, InvalidTransitionError> {
    if (this.props.status !== "blocked") {
      return this.applyTransition("open", now);
    }
    this.props.blockedBy = this.props.blockedBy.filter((id) => id !== blockerId);
    if (this.props.blockedBy.length === 0) {
      return this.applyTransition("open", now);
    }
    this.props.updatedAt = now;
    return { ok: true, data: undefined };
  }

  assignToWave(waveIndex: number, now: Date): void {
    this.props.waveIndex = waveIndex;
    this.props.updatedAt = now;
  }

  static reconstitute(props: TaskProps): Task {
    return new Task(props);
  }

  private applyTransition(target: TaskStatus, now: Date): Result<void, InvalidTransitionError> {
    const currentVO = TaskStatusVO.create(this.props.status);
    const result = currentVO.transitionTo(target);

    if (!result.ok) {
      return result;
    }

    this.props.status = result.data.value;
    this.props.updatedAt = now;
    return { ok: true, data: undefined };
  }
}

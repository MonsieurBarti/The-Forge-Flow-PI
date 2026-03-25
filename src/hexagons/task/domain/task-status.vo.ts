import { err, InvalidTransitionError, ok, type Result, ValueObject } from "@kernel";
import { z } from "zod";
import { type TaskStatus, TaskStatusSchema } from "./task.schemas";

const TaskStatusVOPropsSchema = z.object({ value: TaskStatusSchema });
type TaskStatusVOProps = z.infer<typeof TaskStatusVOPropsSchema>;

export class TaskStatusVO extends ValueObject<TaskStatusVOProps> {
  private static readonly TRANSITIONS: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>> = new Map<
    TaskStatus,
    ReadonlySet<TaskStatus>
  >([
    ["open", new Set(["in_progress", "blocked"])],
    ["in_progress", new Set(["closed"])],
    ["blocked", new Set(["open", "blocked"])],
  ]);

  private constructor(props: TaskStatusVOProps) {
    super(props, TaskStatusVOPropsSchema);
  }

  static create(status: TaskStatus): TaskStatusVO {
    return new TaskStatusVO({ value: status });
  }

  get value(): TaskStatus {
    return this.props.value;
  }

  canTransitionTo(target: TaskStatus): boolean {
    const allowed = TaskStatusVO.TRANSITIONS.get(this.props.value);
    return allowed?.has(target) ?? false;
  }

  transitionTo(target: TaskStatus): Result<TaskStatusVO, InvalidTransitionError> {
    if (!this.canTransitionTo(target)) {
      return err(new InvalidTransitionError(this.props.value, target, "Task"));
    }
    return ok(TaskStatusVO.create(target));
  }
}

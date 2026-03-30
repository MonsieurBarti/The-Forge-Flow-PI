import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import { z } from "zod";

const TaskBlockedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  errorCode: z.string(),
  errorMessage: z.string(),
});

type TaskBlockedEventProps = z.infer<typeof TaskBlockedEventPropsSchema>;

export class TaskBlockedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_BLOCKED;
  readonly sliceId: string;
  readonly taskId: string;
  readonly waveIndex: number;
  readonly errorCode: string;
  readonly errorMessage: string;

  constructor(props: TaskBlockedEventProps) {
    const parsed = TaskBlockedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.taskId = parsed.taskId;
    this.waveIndex = parsed.waveIndex;
    this.errorCode = parsed.errorCode;
    this.errorMessage = parsed.errorMessage;
  }
}

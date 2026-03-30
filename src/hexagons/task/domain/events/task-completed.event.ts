import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName, IdSchema } from "@kernel";
import { z } from "zod";

const TaskCompletedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  commitHash: z.string().optional(),
});

type TaskCompletedEventProps = z.infer<typeof TaskCompletedEventPropsSchema>;

export class TaskCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_COMPLETED;
  readonly sliceId: string;
  readonly taskId: string;
  readonly waveIndex: number;
  readonly durationMs: number;
  readonly commitHash: string | undefined;

  constructor(props: TaskCompletedEventProps) {
    const parsed = TaskCompletedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.taskId = parsed.taskId;
    this.waveIndex = parsed.waveIndex;
    this.durationMs = parsed.durationMs;
    this.commitHash = parsed.commitHash;
  }
}

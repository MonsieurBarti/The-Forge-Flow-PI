import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import { z } from "zod";

const ExecutionPausedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  sessionId: IdSchema,
  resumeCount: z.number().int().min(0),
});

type ExecutionPausedEventProps = z.infer<typeof ExecutionPausedEventPropsSchema>;

export class ExecutionPausedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.EXECUTION_PAUSED;
  readonly sliceId: string;
  readonly sessionId: string;
  readonly resumeCount: number;

  constructor(props: ExecutionPausedEventProps) {
    const parsed = ExecutionPausedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.sessionId = parsed.sessionId;
    this.resumeCount = parsed.resumeCount;
  }
}

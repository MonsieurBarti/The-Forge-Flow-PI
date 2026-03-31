import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import { z } from "zod";

const ExecutionResumedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  sessionId: IdSchema,
  resumeCount: z.number().int().min(0),
});

type ExecutionResumedEventProps = z.infer<typeof ExecutionResumedEventPropsSchema>;

export class ExecutionResumedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.EXECUTION_RESUMED;
  readonly sliceId: string;
  readonly sessionId: string;
  readonly resumeCount: number;

  constructor(props: ExecutionResumedEventProps) {
    const parsed = ExecutionResumedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.sessionId = parsed.sessionId;
    this.resumeCount = parsed.resumeCount;
  }
}

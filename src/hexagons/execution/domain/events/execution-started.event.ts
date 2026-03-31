import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import type { z } from "zod";

const ExecutionStartedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  milestoneId: IdSchema,
  sessionId: IdSchema,
});

type ExecutionStartedEventProps = z.infer<typeof ExecutionStartedEventPropsSchema>;

export class ExecutionStartedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.EXECUTION_STARTED;
  readonly sliceId: string;
  readonly milestoneId: string;
  readonly sessionId: string;

  constructor(props: ExecutionStartedEventProps) {
    const parsed = ExecutionStartedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.milestoneId = parsed.milestoneId;
    this.sessionId = parsed.sessionId;
  }
}

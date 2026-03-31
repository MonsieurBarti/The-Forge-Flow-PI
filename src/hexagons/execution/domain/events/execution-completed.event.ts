import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import { z } from "zod";

const ExecutionCompletedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  sessionId: IdSchema,
  resumeCount: z.number().int().min(0),
  wavesCompleted: z.number().int().min(0),
  totalWaves: z.number().int().min(0),
});

type ExecutionCompletedEventProps = z.infer<typeof ExecutionCompletedEventPropsSchema>;

export class ExecutionCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.EXECUTION_COMPLETED;
  readonly sliceId: string;
  readonly sessionId: string;
  readonly resumeCount: number;
  readonly wavesCompleted: number;
  readonly totalWaves: number;

  constructor(props: ExecutionCompletedEventProps) {
    const parsed = ExecutionCompletedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.sessionId = parsed.sessionId;
    this.resumeCount = parsed.resumeCount;
    this.wavesCompleted = parsed.wavesCompleted;
    this.totalWaves = parsed.totalWaves;
  }
}

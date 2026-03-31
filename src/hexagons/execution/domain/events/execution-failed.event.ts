import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import { z } from "zod";

const ExecutionFailedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  sessionId: IdSchema,
  resumeCount: z.number().int().min(0),
  failureReason: z.string().min(1),
  wavesCompleted: z.number().int().min(0).optional(),
  totalWaves: z.number().int().min(0).optional(),
});

type ExecutionFailedEventProps = z.infer<typeof ExecutionFailedEventPropsSchema>;

export class ExecutionFailedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.EXECUTION_FAILED;
  readonly sliceId: string;
  readonly sessionId: string;
  readonly resumeCount: number;
  readonly failureReason: string;
  readonly wavesCompleted?: number;
  readonly totalWaves?: number;

  constructor(props: ExecutionFailedEventProps) {
    const parsed = ExecutionFailedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.sessionId = parsed.sessionId;
    this.resumeCount = parsed.resumeCount;
    this.failureReason = parsed.failureReason;
    this.wavesCompleted = parsed.wavesCompleted;
    this.totalWaves = parsed.totalWaves;
  }
}

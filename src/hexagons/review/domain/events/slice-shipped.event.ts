import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import { z } from "zod";

const SliceShippedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  prNumber: z.number().int().positive(),
  prUrl: z.string().url(),
  fixCyclesUsed: z.number().int().min(0),
});
type SliceShippedEventProps = z.infer<typeof SliceShippedEventPropsSchema>;

export class SliceShippedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.SLICE_SHIPPED;
  readonly sliceId: string;
  readonly prNumber: number;
  readonly prUrl: string;
  readonly fixCyclesUsed: number;

  constructor(props: SliceShippedEventProps) {
    const parsed = SliceShippedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.prNumber = parsed.prNumber;
    this.prUrl = parsed.prUrl;
    this.fixCyclesUsed = parsed.fixCyclesUsed;
  }
}

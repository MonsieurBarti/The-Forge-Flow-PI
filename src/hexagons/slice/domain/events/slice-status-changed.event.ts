import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName } from "@kernel";
import { z } from "zod";

const SliceStatusChangedEventPropsSchema = DomainEventPropsSchema.extend({
  from: z.string(),
  to: z.string(),
});

type SliceStatusChangedEventProps = z.infer<typeof SliceStatusChangedEventPropsSchema>;

export class SliceStatusChangedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.SLICE_STATUS_CHANGED;
  readonly from: string;
  readonly to: string;

  constructor(props: SliceStatusChangedEventProps) {
    const parsed = SliceStatusChangedEventPropsSchema.parse(props);
    super(parsed);
    this.from = parsed.from;
    this.to = parsed.to;
  }
}

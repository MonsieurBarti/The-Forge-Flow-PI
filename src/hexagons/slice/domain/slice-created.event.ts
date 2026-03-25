import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class SliceCreatedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.SLICE_CREATED;
}

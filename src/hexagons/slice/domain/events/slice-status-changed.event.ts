import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class SliceStatusChangedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.SLICE_STATUS_CHANGED;
}

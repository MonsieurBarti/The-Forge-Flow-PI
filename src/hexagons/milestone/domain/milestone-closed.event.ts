import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class MilestoneClosedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.MILESTONE_CLOSED;
}

import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class MilestoneCreatedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.MILESTONE_CREATED;
}

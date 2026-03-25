import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class TaskCreatedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_CREATED;
}

import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class TaskBlockedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_BLOCKED;
}

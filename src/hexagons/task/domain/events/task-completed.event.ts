import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class TaskCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_COMPLETED;
}

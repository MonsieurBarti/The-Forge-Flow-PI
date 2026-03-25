import { DomainEvent, EVENT_NAMES, type EventName } from "@kernel";

export class ProjectInitializedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.PROJECT_INITIALIZED;
}

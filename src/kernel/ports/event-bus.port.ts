import type { DomainEvent } from "@kernel/domain-event.base";
import type { EventName } from "@kernel/event-names";

export abstract class EventBusPort {
  abstract publish(event: DomainEvent): Promise<void>;
  abstract subscribe(eventType: EventName, handler: (event: DomainEvent) => Promise<void>): void;
}

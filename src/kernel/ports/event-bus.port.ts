import type { DomainEvent } from "@kernel/domain-event.base";
import type { EventName } from "@kernel/event-names";

export abstract class EventBusPort {
  abstract publish(event: DomainEvent): Promise<void>;
  abstract subscribe<T extends DomainEvent>(
    eventType: EventName,
    handler: (event: T) => Promise<void>,
  ): void;
}

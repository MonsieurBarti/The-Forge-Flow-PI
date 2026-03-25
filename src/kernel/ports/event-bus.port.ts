import type { DomainEvent } from "@kernel/domain-event.base";

export abstract class EventBusPort {
  abstract publish(event: DomainEvent): Promise<void>;
  abstract subscribe<T extends DomainEvent>(
    eventType: string,
    handler: (event: T) => Promise<void>,
  ): void;
}

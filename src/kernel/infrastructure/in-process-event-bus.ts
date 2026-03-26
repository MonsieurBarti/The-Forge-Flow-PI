import type { DomainEvent } from "@kernel/domain-event.base";
import type { EventName } from "@kernel/event-names";
import { EventBusPort } from "@kernel/ports/event-bus.port";
import type { LoggerPort } from "@kernel/ports/logger.port";

export class InProcessEventBus extends EventBusPort {
  private handlers = new Map<EventName, Array<(event: DomainEvent) => Promise<void>>>();

  constructor(private readonly logger: LoggerPort) {
    super();
  }

  subscribe(eventType: EventName, handler: (event: DomainEvent) => Promise<void>): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventName) ?? [];
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error: unknown) {
        this.logger.error("Event handler failed", {
          eventName: event.eventName,
          eventId: event.id,
          aggregateId: event.aggregateId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

import type { DomainEvent } from "./domain-event.base";
import { Entity } from "./entity.base";

export abstract class AggregateRoot<TProps> extends Entity<TProps> {
  private domainEvents: DomainEvent[] = [];

  protected addEvent(event: DomainEvent): void {
    this.domainEvents.push(event);
  }

  pullEvents(): DomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents = [];
    return events;
  }
}

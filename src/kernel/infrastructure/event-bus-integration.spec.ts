import { AggregateRoot } from "@kernel/aggregate-root.base";
import { DomainEvent } from "@kernel/domain-event.base";
import type { EventName } from "@kernel/event-names";
import { EVENT_NAMES } from "@kernel/event-names";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InProcessEventBus } from "./in-process-event-bus";
import { SilentLoggerAdapter } from "./silent-logger.adapter";

const TestAggSchema = z.object({ id: z.string().uuid(), name: z.string() });
type TestAggProps = z.infer<typeof TestAggSchema>;

class ItemCreatedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.PROJECT_INITIALIZED;
  constructor(aggregateId: string) {
    super({ id: crypto.randomUUID(), aggregateId, occurredAt: new Date() });
  }
}

class TestAggregate extends AggregateRoot<TestAggProps> {
  constructor(props: TestAggProps) {
    super(props, TestAggSchema);
  }

  get id(): string {
    return this.props.id;
  }

  doAction(): void {
    this.addEvent(new ItemCreatedEvent(this.id));
  }
}

describe("EventBus integration: aggregate -> publish -> handler", () => {
  it("events pulled from aggregate are dispatched through the bus", async () => {
    const logger = new SilentLoggerAdapter();
    const bus = new InProcessEventBus(logger);
    const received: DomainEvent[] = [];

    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async (event) => {
      received.push(event);
    });

    const aggregate = new TestAggregate({
      id: crypto.randomUUID(),
      name: "Test",
    });
    aggregate.doAction();
    aggregate.doAction();

    const events = aggregate.pullEvents();
    for (const event of events) {
      await bus.publish(event);
    }

    expect(received).toHaveLength(2);
    expect(received[0].aggregateId).toBe(aggregate.id);
    expect(received[1].aggregateId).toBe(aggregate.id);
  });

  it("handler error in integration flow does not lose remaining events", async () => {
    const logger = new SilentLoggerAdapter();
    const bus = new InProcessEventBus(logger);
    const received: DomainEvent[] = [];

    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => {
      throw new Error("handler failure");
    });
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async (event) => {
      received.push(event);
    });

    const aggregate = new TestAggregate({
      id: crypto.randomUUID(),
      name: "Test",
    });
    aggregate.doAction();

    const events = aggregate.pullEvents();
    for (const event of events) {
      await bus.publish(event);
    }

    expect(received).toHaveLength(1);
    expect(logger.getMessages()).toHaveLength(1);
  });
});

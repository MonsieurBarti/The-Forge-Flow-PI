import { DomainEvent } from "@kernel/domain-event.base";
import type { EventName } from "@kernel/event-names";
import { EVENT_NAMES } from "@kernel/event-names";
import { describe, expect, it } from "vitest";
import { InProcessEventBus } from "./in-process-event-bus";
import { SilentLoggerAdapter } from "./silent-logger.adapter";

class TestEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.PROJECT_INITIALIZED;
  constructor(aggregateId: string) {
    super({ id: crypto.randomUUID(), aggregateId, occurredAt: new Date() });
  }
}

class OtherEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_COMPLETED;
  constructor(aggregateId: string) {
    super({ id: crypto.randomUUID(), aggregateId, occurredAt: new Date() });
  }
}

function createBus() {
  const logger = new SilentLoggerAdapter();
  const bus = new InProcessEventBus(logger);
  return { bus, logger };
}

describe("InProcessEventBus", () => {
  it("publishes event to subscribed handler", async () => {
    const { bus } = createBus();
    const received: DomainEvent[] = [];
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async (event) => {
      received.push(event);
    });

    const event = new TestEvent(crypto.randomUUID());
    await bus.publish(event);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(event);
  });

  it("executes multiple handlers in subscription order", async () => {
    const { bus } = createBus();
    const order: number[] = [];
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => {
      order.push(1);
    });
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => {
      order.push(2);
    });
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => {
      order.push(3);
    });

    await bus.publish(new TestEvent(crypto.randomUUID()));
    expect(order).toEqual([1, 2, 3]);
  });

  it("handler error does not prevent subsequent handlers", async () => {
    const { bus } = createBus();
    const received: string[] = [];
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => {
      received.push("first");
    });
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => {
      throw new Error("boom");
    });
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => {
      received.push("third");
    });

    await bus.publish(new TestEvent(crypto.randomUUID()));
    expect(received).toEqual(["first", "third"]);
  });

  it("handler error is logged with event context", async () => {
    const { bus, logger } = createBus();
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => {
      throw new Error("handler broke");
    });

    const event = new TestEvent(crypto.randomUUID());
    await bus.publish(event);

    const messages = logger.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].level).toBe("error");
    expect(messages[0].message).toBe("Event handler failed");
    expect(messages[0].context).toEqual({
      eventName: EVENT_NAMES.PROJECT_INITIALIZED,
      eventId: event.id,
      aggregateId: event.aggregateId,
      error: "handler broke",
    });
  });

  it("logs non-Error thrown values as strings", async () => {
    const { bus, logger } = createBus();
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => {
      throw "string error";
    });

    await bus.publish(new TestEvent(crypto.randomUUID()));

    const messages = logger.getMessages();
    expect(messages[0].context).toMatchObject({ error: "string error" });
  });

  it("no subscribers means no error", async () => {
    const { bus } = createBus();
    await expect(bus.publish(new TestEvent(crypto.randomUUID()))).resolves.toBeUndefined();
  });

  it("routes events to correct handlers by event type", async () => {
    const { bus } = createBus();
    const projectEvents: DomainEvent[] = [];
    const taskEvents: DomainEvent[] = [];
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async (e) => {
      projectEvents.push(e);
    });
    bus.subscribe(EVENT_NAMES.TASK_COMPLETED, async (e) => {
      taskEvents.push(e);
    });

    await bus.publish(new TestEvent(crypto.randomUUID()));
    await bus.publish(new OtherEvent(crypto.randomUUID()));

    expect(projectEvents).toHaveLength(1);
    expect(taskEvents).toHaveLength(1);
  });

  it("handlers execute sequentially, not concurrently", async () => {
    const { bus } = createBus();
    let concurrent = 0;
    let maxConcurrent = 0;
    const handler = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent--;
    };
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, handler);
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, handler);
    bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, handler);

    await bus.publish(new TestEvent(crypto.randomUUID()));
    expect(maxConcurrent).toBe(1);
  });
});

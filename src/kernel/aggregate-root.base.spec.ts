import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AggregateRoot } from "./aggregate-root.base";
import { DomainEvent } from "./domain-event.base";
import { EVENT_NAMES } from "./event-names";

const TestAggregateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

type TestAggregateProps = z.infer<typeof TestAggregateSchema>;

class TestEvent extends DomainEvent {
  readonly eventName = EVENT_NAMES.PROJECT_INITIALIZED;

  constructor(aggregateId: string) {
    super({
      id: crypto.randomUUID(),
      aggregateId,
      occurredAt: new Date(),
    });
  }
}

class TestAggregate extends AggregateRoot<TestAggregateProps> {
  constructor(props: TestAggregateProps) {
    super(props, TestAggregateSchema);
  }

  get id(): string {
    return this.props.id;
  }

  doSomething(): void {
    this.addEvent(new TestEvent(this.id));
  }
}

describe("AggregateRoot", () => {
  const validProps: TestAggregateProps = {
    id: crypto.randomUUID(),
    name: "Test Aggregate",
  };

  it("constructs with valid props (inherits Entity validation)", () => {
    const aggregate = new TestAggregate(validProps);
    expect(aggregate).toBeInstanceOf(TestAggregate);
    expect(aggregate.id).toBe(validProps.id);
  });

  it("pullEvents returns empty array when no events added", () => {
    const aggregate = new TestAggregate(validProps);
    expect(aggregate.pullEvents()).toEqual([]);
  });

  it("addEvent + pullEvents returns the added events", () => {
    const aggregate = new TestAggregate(validProps);
    aggregate.doSomething();
    const events = aggregate.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe(EVENT_NAMES.PROJECT_INITIALIZED);
    expect(events[0].aggregateId).toBe(validProps.id);
  });

  it("pullEvents clears the internal list (second call returns empty)", () => {
    const aggregate = new TestAggregate(validProps);
    aggregate.doSomething();
    aggregate.pullEvents();
    expect(aggregate.pullEvents()).toEqual([]);
  });

  it("multiple events are returned in order", () => {
    const aggregate = new TestAggregate(validProps);
    aggregate.doSomething();
    aggregate.doSomething();
    aggregate.doSomething();
    const events = aggregate.pullEvents();
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.eventName).toBe(EVENT_NAMES.PROJECT_INITIALIZED);
    }
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { DomainEventProps } from "./domain-event.base";
import { DomainEvent } from "./domain-event.base";
import { EVENT_NAMES } from "./event-names";

class TestEvent extends DomainEvent {
  readonly eventName = EVENT_NAMES.PROJECT_INITIALIZED;
}

function validProps(overrides?: Partial<DomainEventProps>): DomainEventProps {
  return {
    id: crypto.randomUUID(),
    aggregateId: crypto.randomUUID(),
    occurredAt: new Date(),
    ...overrides,
  };
}

function invalidProps(overrides: Record<string, unknown>): DomainEventProps {
  return Object.assign(validProps(), overrides);
}

describe("DomainEvent", () => {
  it("constructs with valid props including optional fields", () => {
    const correlationId = crypto.randomUUID();
    const causationId = crypto.randomUUID();
    const event = new TestEvent(validProps({ correlationId, causationId }));

    expect(event).toBeInstanceOf(DomainEvent);
    expect(event.correlationId).toBe(correlationId);
    expect(event.causationId).toBe(causationId);
  });

  it("constructs with optional fields omitted", () => {
    const event = new TestEvent(validProps());

    expect(event).toBeInstanceOf(DomainEvent);
    expect(event.correlationId).toBeUndefined();
    expect(event.causationId).toBeUndefined();
  });

  it("throws ZodError on invalid id", () => {
    expect(() => new TestEvent(invalidProps({ id: "not-a-uuid" }))).toThrow(z.ZodError);
  });

  it("throws ZodError on invalid aggregateId", () => {
    expect(() => new TestEvent(invalidProps({ aggregateId: "not-a-uuid" }))).toThrow(z.ZodError);
  });

  it("coerces ISO string occurredAt to Date instance", () => {
    const iso = "2024-01-15T10:30:00.000Z";
    const event = new TestEvent(invalidProps({ occurredAt: iso }));

    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.occurredAt.toISOString()).toBe(iso);
  });

  it("individual properties are accessible", () => {
    const id = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();
    const occurredAt = new Date("2024-06-01T00:00:00Z");
    const correlationId = crypto.randomUUID();
    const causationId = crypto.randomUUID();

    const event = new TestEvent({
      id,
      aggregateId,
      occurredAt,
      correlationId,
      causationId,
    });

    expect(event.id).toBe(id);
    expect(event.aggregateId).toBe(aggregateId);
    expect(event.occurredAt).toEqual(occurredAt);
    expect(event.correlationId).toBe(correlationId);
    expect(event.causationId).toBe(causationId);
  });

  it("eventName is accessible on subclass", () => {
    const event = new TestEvent(validProps());
    expect(event.eventName).toBe(EVENT_NAMES.PROJECT_INITIALIZED);
  });
});

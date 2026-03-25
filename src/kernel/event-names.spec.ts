import { describe, expect, expectTypeOf, it } from "vitest";
import type { EventName } from "./event-names";
import { EVENT_NAMES, EventNameSchema } from "./event-names";

describe("EVENT_NAMES", () => {
  it("contains all 12 event names", () => {
    expect(Object.keys(EVENT_NAMES)).toHaveLength(12);
  });

  it("all values are unique", () => {
    const values = Object.values(EVENT_NAMES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("values follow domain.action format", () => {
    for (const value of Object.values(EVENT_NAMES)) {
      expect(value).toMatch(/^[a-z]+\.[a-z-]+$/);
    }
  });
});

describe("EventName type", () => {
  it("accepts valid event name literals", () => {
    expectTypeOf<"project.initialized">().toMatchTypeOf<EventName>();
    expectTypeOf<"slice.status-changed">().toMatchTypeOf<EventName>();
  });

  it("rejects arbitrary strings", () => {
    expectTypeOf<"not.a.real.event">().not.toMatchTypeOf<EventName>();
  });
});

describe("EventNameSchema", () => {
  it("parses valid event names", () => {
    for (const name of Object.values(EVENT_NAMES)) {
      expect(EventNameSchema.parse(name)).toBe(name);
    }
  });

  it("rejects invalid strings", () => {
    expect(() => EventNameSchema.parse("invalid.event")).toThrow();
  });
});

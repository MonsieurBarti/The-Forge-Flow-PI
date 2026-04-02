import { EVENT_NAMES } from "@kernel";
import { describe, expect, it } from "vitest";
import { SliceShippedEvent } from "./slice-shipped.event";

describe("SliceShippedEvent", () => {
  it("constructs with valid props", () => {
    const e = new SliceShippedEvent({
      id: crypto.randomUUID(),
      aggregateId: crypto.randomUUID(),
      occurredAt: new Date(),
      sliceId: crypto.randomUUID(),
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      fixCyclesUsed: 1,
    });
    expect(e.eventName).toBe(EVENT_NAMES.SLICE_SHIPPED);
    expect(e.prNumber).toBe(42);
    expect(e.fixCyclesUsed).toBe(1);
  });
});

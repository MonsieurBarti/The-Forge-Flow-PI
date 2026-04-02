import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VerificationCompletedEvent } from "./verification-completed.event";

describe("VerificationCompletedEvent", () => {
  const validProps = () => ({
    id: randomUUID(),
    aggregateId: randomUUID(),
    occurredAt: new Date(),
    sliceId: randomUUID(),
    finalVerdict: "PASS" as const,
    criteriaCount: 5,
    passCount: 5,
    failCount: 0,
    fixCyclesUsed: 0,
    retriedVerification: false,
  });

  it("creates with valid props", () => {
    const props = validProps();
    const event = new VerificationCompletedEvent(props);
    expect(event.eventName).toBe("review.verification-completed");
    expect(event.finalVerdict).toBe("PASS");
    expect(event.criteriaCount).toBe(5);
    expect(event.passCount).toBe(5);
    expect(event.failCount).toBe(0);
  });

  it("creates with FAIL verdict", () => {
    const event = new VerificationCompletedEvent({
      ...validProps(),
      finalVerdict: "FAIL",
      criteriaCount: 3,
      passCount: 1,
      failCount: 2,
      fixCyclesUsed: 2,
      retriedVerification: true,
    });
    expect(event.finalVerdict).toBe("FAIL");
    expect(event.fixCyclesUsed).toBe(2);
    expect(event.retriedVerification).toBe(true);
  });

  it("rejects invalid verdict", () => {
    expect(
      () =>
        new VerificationCompletedEvent({
          ...validProps(),
          finalVerdict: "MAYBE" as never,
        }),
    ).toThrow();
  });

  it("rejects negative criteriaCount", () => {
    expect(
      () =>
        new VerificationCompletedEvent({
          ...validProps(),
          criteriaCount: -1,
        }),
    ).toThrow();
  });
});

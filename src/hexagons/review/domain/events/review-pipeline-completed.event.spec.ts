import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReviewPipelineCompletedEvent } from "./review-pipeline-completed.event";

describe("ReviewPipelineCompletedEvent", () => {
  const validProps = () => ({
    id: randomUUID(),
    aggregateId: randomUUID(),
    occurredAt: new Date(),
    sliceId: randomUUID(),
    verdict: "approved" as const,
    reviewCount: 3,
    findingsCount: 5,
    blockerCount: 1,
    conflictCount: 0,
    fixCyclesUsed: 1,
    timedOutRoles: [] as ("code-reviewer" | "spec-reviewer" | "security-auditor")[],
    retriedRoles: ["code-reviewer"] as ("code-reviewer" | "spec-reviewer" | "security-auditor")[],
  });

  it("constructs with all fields", () => {
    const props = validProps();
    const event = new ReviewPipelineCompletedEvent(props);
    expect(event.sliceId).toBe(props.sliceId);
    expect(event.verdict).toBe("approved");
    expect(event.reviewCount).toBe(3);
    expect(event.findingsCount).toBe(5);
    expect(event.blockerCount).toBe(1);
    expect(event.conflictCount).toBe(0);
    expect(event.fixCyclesUsed).toBe(1);
    expect(event.timedOutRoles).toEqual([]);
    expect(event.retriedRoles).toEqual(["code-reviewer"]);
  });

  it("has correct eventName", () => {
    const event = new ReviewPipelineCompletedEvent(validProps());
    expect(event.eventName).toBe("review.pipeline-completed");
  });

  it("rejects negative findingsCount", () => {
    expect(
      () => new ReviewPipelineCompletedEvent({ ...validProps(), findingsCount: -1 }),
    ).toThrow();
  });

  it("rejects invalid verdict", () => {
    expect(
      () => new ReviewPipelineCompletedEvent({ ...validProps(), verdict: "invalid" as never }),
    ).toThrow();
  });
});

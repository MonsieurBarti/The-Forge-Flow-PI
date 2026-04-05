import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { InMemoryReviewUIAdapter } from "./in-memory-review-ui.adapter";

describe("InMemoryReviewUIAdapter", () => {
  it("records presentFindings call in log (AC7)", async () => {
    const adapter = new InMemoryReviewUIAdapter();
    const ctx = {
      sliceId: "s1",
      sliceLabel: "M05-S05",
      verdict: "approved" as const,
      findings: [],
      conflicts: [],
      fixCyclesUsed: 0,
      timedOutReviewers: [],
    };
    const result = await adapter.presentFindings(ctx);
    expect(isOk(result)).toBe(true);
    expect(adapter.presentations).toHaveLength(1);
    expect(adapter.presentations[0].method).toBe("presentFindings");
    expect(adapter.presentations[0].context).toEqual(ctx);
  });

  it("records presentVerification call in log", async () => {
    const adapter = new InMemoryReviewUIAdapter();
    const ctx = {
      sliceId: "s1",
      sliceLabel: "M05-S05",
      criteria: [{ criterion: "AC1", verdict: "PASS" as const, evidence: "ok" }],
      overallVerdict: "PASS" as const,
    };
    const result = await adapter.presentVerification(ctx);
    expect(isOk(result)).toBe(true);
    expect(adapter.presentations).toHaveLength(1);
    expect(adapter.presentations[0].method).toBe("presentVerification");
  });

  it("records presentForApproval call in log", async () => {
    const adapter = new InMemoryReviewUIAdapter();
    const ctx = {
      sliceId: "s1",
      sliceLabel: "M05-S05",
      artifactType: "spec" as const,
      artifactPath: "/path/to/SPEC.md",
      summary: "Review UI port spec",
    };
    const result = await adapter.presentForApproval(ctx);
    expect(isOk(result)).toBe(true);
    expect(adapter.presentations).toHaveLength(1);
    expect(adapter.presentations[0].method).toBe("presentForApproval");
  });

  it("uses queued responses when provided", async () => {
    const adapter = new InMemoryReviewUIAdapter({
      approvalResponses: [{ decision: "rejected", formattedOutput: "No.", feedback: "Fix it" }],
    });
    const ctx = {
      sliceId: "s1",
      sliceLabel: "M05-S05",
      artifactType: "plan" as const,
      artifactPath: "/p",
      summary: "x",
    };
    const result = await adapter.presentForApproval(ctx);
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.data.decision).toBe("rejected");
      expect(result.data.feedback).toBe("Fix it");
    }
  });
});

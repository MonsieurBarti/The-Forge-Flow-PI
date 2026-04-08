import { isOk } from "@kernel";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { PlannotatorEventEmitter } from "./plannotator-review-ui.adapter";
import { PlannotatorReviewUIAdapter } from "./plannotator-review-ui.adapter";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/tff-review-ui-mock"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue("# Plan content"),
}));

import { execFile } from "node:child_process";

function mockExecFile(stdout: string) {
  (execFile as unknown as Mock).mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string) => void,
    ) => {
      cb(null, stdout);
    },
  );
}

function mockExecFileError(message: string) {
  (execFile as unknown as Mock).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
      cb(new Error(message));
    },
  );
}

function createMockEvents(options?: {
  ackResponse?: unknown;
  reviewResult?: { reviewId: string; approved: boolean; feedback?: string };
}): PlannotatorEventEmitter {
  const listeners = new Map<string, ((data: unknown) => void)[]>();

  return {
    emit(channel: string, data: unknown) {
      if (channel === "plannotator:request") {
        const request = data as { respond: (r: unknown) => void; action: string };
        // Simulate plannotator acknowledging the request
        if (options?.ackResponse) {
          setTimeout(() => request.respond(options.ackResponse), 0);
        }
        // Simulate review result arriving
        if (options?.reviewResult) {
          setTimeout(() => {
            const handlers = listeners.get("plannotator:review-result") ?? [];
            for (const h of handlers) h(options.reviewResult);
          }, 10);
        }
      }
    },
    on(channel: string, handler: (data: unknown) => void): () => void {
      const existing = listeners.get(channel) ?? [];
      existing.push(handler);
      listeners.set(channel, existing);
      return () => {
        const arr = listeners.get(channel) ?? [];
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      };
    },
  };
}

const APPROVAL_CTX = {
  sliceId: "M08-S05",
  sliceLabel: "TEST-S05",
  artifactType: "plan" as const,
  artifactPath: "/tmp/PLAN.md",
  summary: "Test plan",
};

describe("PlannotatorReviewUIAdapter", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("presentFindings (CLI annotate)", () => {
    it("returns acknowledged with formatted output", async () => {
      const events = createMockEvents();
      const adapter = new PlannotatorReviewUIAdapter("/usr/bin/plannotator", events);
      mockExecFile("Reviewed: 0 findings");
      const result = await adapter.presentFindings({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        verdict: "approved",
        findings: [],
        conflicts: [],
        fixCyclesUsed: 0,
        timedOutReviewers: [],
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.acknowledged).toBe(true);
        expect(result.data.formattedOutput).toBe("Reviewed: 0 findings");
      }
    });

    it("returns fallback on error", async () => {
      const events = createMockEvents();
      const adapter = new PlannotatorReviewUIAdapter("/usr/bin/plannotator", events);
      mockExecFileError("plannotator crashed");
      const result = await adapter.presentFindings({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        verdict: "approved",
        findings: [],
        conflicts: [],
        fixCyclesUsed: 0,
        timedOutReviewers: [],
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.acknowledged).toBe(true);
        expect(result.data.formattedOutput).toContain("plannotator error");
      }
    });
  });

  describe("presentVerification (CLI annotate)", () => {
    it("returns accepted with formatted output", async () => {
      const events = createMockEvents();
      const adapter = new PlannotatorReviewUIAdapter("/usr/bin/plannotator", events);
      mockExecFile("Verification complete");
      const result = await adapter.presentVerification({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        criteria: [{ criterion: "AC1", verdict: "PASS", evidence: "test passed" }],
        overallVerdict: "PASS",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.accepted).toBe(true);
        expect(result.data.formattedOutput).toBe("Verification complete");
      }
    });
  });

  describe("presentForApproval (event-based plan-review)", () => {
    it("returns approved when plannotator review is approved", async () => {
      const reviewId = "test-review-123";
      const events = createMockEvents({
        ackResponse: { status: "handled", result: { status: "pending", reviewId } },
        reviewResult: { reviewId, approved: true },
      });
      const adapter = new PlannotatorReviewUIAdapter("/usr/bin/plannotator", events);
      const result = await adapter.presentForApproval(APPROVAL_CTX);
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("approved");
      }
    });

    it("returns changes_requested with feedback when review is rejected", async () => {
      const reviewId = "test-review-456";
      const events = createMockEvents({
        ackResponse: { status: "handled", result: { status: "pending", reviewId } },
        reviewResult: { reviewId, approved: false, feedback: "Missing error handling" },
      });
      const adapter = new PlannotatorReviewUIAdapter("/usr/bin/plannotator", events);
      const result = await adapter.presentForApproval(APPROVAL_CTX);
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("changes_requested");
        expect(result.data.feedback).toBe("Missing error handling");
      }
    });

    it("falls back to annotate when plannotator is unavailable", async () => {
      const events = createMockEvents({
        ackResponse: { status: "unavailable", error: "Plannotator not ready" },
      });
      const adapter = new PlannotatorReviewUIAdapter("/usr/bin/plannotator", events);
      mockExecFile("LGTM — no changes needed");
      const result = await adapter.presentForApproval(APPROVAL_CTX);
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("approved");
      }
    });

    it("falls back to annotate on ack timeout", async () => {
      // No ackResponse → respond callback never called → timeout
      const events = createMockEvents();
      const adapter = new PlannotatorReviewUIAdapter("/usr/bin/plannotator", events);
      mockExecFile("LGTM");
      const result = await adapter.presentForApproval(APPROVAL_CTX);
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        // Falls back to annotate which returns approved (no change markers)
        expect(result.data.decision).toBe("approved");
      }
    }, 15_000);

    it("returns changes_requested when both event and annotate fail", async () => {
      const events = createMockEvents();
      const adapter = new PlannotatorReviewUIAdapter("/usr/bin/plannotator", events);
      mockExecFileError("plannotator not found");
      const result = await adapter.presentForApproval(APPROVAL_CTX);
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("changes_requested");
        expect(result.data.formattedOutput).toContain("plannotator error");
      }
    }, 15_000);
  });
});

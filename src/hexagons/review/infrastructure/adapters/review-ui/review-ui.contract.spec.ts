import { isOk } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import type { ReviewUIPort } from "../../../domain/ports/review-ui.port";
import { InMemoryReviewUIAdapter } from "./in-memory-review-ui.adapter";
import { PlannotatorReviewUIAdapter } from "./plannotator-review-ui.adapter";
import { TerminalReviewUIAdapter } from "./terminal-review-ui.adapter";

// Contract: all adapters return Ok<*UIResponse> for valid contexts
function contractSuite(name: string, createAdapter: () => ReviewUIPort) {
  describe(`${name} — ReviewUIPort contract`, () => {
    it("presentFindings returns Ok for valid context (AC8)", async () => {
      const adapter = createAdapter();
      const result = await adapter.presentFindings({
        sliceId: "s1",
        sliceLabel: "M05-S05",
        verdict: "approved",
        findings: [],
        conflicts: [],
        fixCyclesUsed: 0,
        timedOutReviewers: [],
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.formattedOutput.length).toBeGreaterThan(0);
    });

    it("presentVerification returns Ok for valid context (AC8)", async () => {
      const adapter = createAdapter();
      const result = await adapter.presentVerification({
        sliceId: "s1",
        sliceLabel: "M05-S05",
        criteria: [{ criterion: "AC1", verdict: "PASS", evidence: "output" }],
        overallVerdict: "PASS",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.formattedOutput.length).toBeGreaterThan(0);
    });

    it("presentForApproval returns Ok for valid context (AC8)", async () => {
      const adapter = createAdapter();
      const result = await adapter.presentForApproval({
        sliceId: "s1",
        sliceLabel: "M05-S05",
        artifactType: "spec",
        artifactPath: "/path/SPEC.md",
        summary: "test",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.formattedOutput.length).toBeGreaterThan(0);
    });
  });
}

contractSuite("InMemoryReviewUIAdapter", () => new InMemoryReviewUIAdapter());
contractSuite("TerminalReviewUIAdapter", () => new TerminalReviewUIAdapter());

type ExecFileCallback = (...args: unknown[]) => unknown;

// PlannotatorReviewUIAdapter — mock subprocess to satisfy AC8 (all 3 adapters)
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
    cb(null, "User reviewed the document and has no feedback.", "");
  }),
}));

contractSuite(
  "PlannotatorReviewUIAdapter",
  () => new PlannotatorReviewUIAdapter("/mock/plannotator"),
);

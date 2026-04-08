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

// PlannotatorReviewUIAdapter — mock subprocess + events to satisfy AC8 (all 3 adapters)
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
    cb(null, "User reviewed the document and has no feedback.", "");
  }),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("# Mock plan content"),
  mkdtemp: vi.fn().mockResolvedValue("/tmp/tff-mock"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

const mockEvents = {
  emit(channel: string, data: unknown) {
    if (channel === "plannotator:request") {
      const req = data as { respond: (r: unknown) => void };
      // Simulate unavailable — forces annotate fallback
      setTimeout(() => req.respond({ status: "unavailable" }), 0);
    }
  },
  on() {
    return () => {};
  },
};

contractSuite(
  "PlannotatorReviewUIAdapter",
  () => new PlannotatorReviewUIAdapter("/mock/plannotator", mockEvents),
);

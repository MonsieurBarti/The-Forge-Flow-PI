import { isOk } from "@kernel";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { PlannotatorReviewUIAdapter } from "./plannotator-review-ui.adapter";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/tff-review-ui-mock"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
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

describe("PlannotatorReviewUIAdapter", () => {
  const adapter = new PlannotatorReviewUIAdapter("/usr/bin/plannotator");

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("presentFindings", () => {
    it("returns acknowledged with formatted output", async () => {
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

  describe("presentVerification", () => {
    it("returns accepted with formatted output", async () => {
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

  describe("presentForApproval", () => {
    it("returns approved when no change markers in output", async () => {
      mockExecFile("LGTM — no changes needed");
      const result = await adapter.presentForApproval({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        artifactType: "plan",
        artifactPath: "/tmp/PLAN.md",
        summary: "Test plan",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("approved");
        expect(result.data.feedback).toBeUndefined();
      }
    });

    it("returns changes_requested when output contains [DELETION]", async () => {
      mockExecFile("Found issue [DELETION] remove this section");
      const result = await adapter.presentForApproval({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        artifactType: "plan",
        artifactPath: "/tmp/PLAN.md",
        summary: "Test plan",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("changes_requested");
        expect(result.data.feedback).toBeDefined();
      }
    });

    it("returns changes_requested on error for safety", async () => {
      mockExecFileError("timeout");
      const result = await adapter.presentForApproval({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        artifactType: "plan",
        artifactPath: "/tmp/PLAN.md",
        summary: "Test plan",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("changes_requested");
        expect(result.data.formattedOutput).toContain("plannotator error");
      }
    });
  });
});

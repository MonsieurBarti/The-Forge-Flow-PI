import * as childProcess from "node:child_process";
import { isOk } from "@kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlannotatorReviewUIAdapter } from "./plannotator-review-ui.adapter";

vi.mock("node:child_process");

type ExecFileCallback = (...args: unknown[]) => unknown;

// Helper: mock execFile to call callback with given stdout
function mockExecFile(stdout: string) {
  vi.mocked(childProcess.execFile).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as ExecFileCallback)(null, stdout, "");
      return {} as ReturnType<typeof childProcess.execFile>;
    },
  );
}

function mockExecFileError(errorMsg: string) {
  vi.mocked(childProcess.execFile).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as ExecFileCallback)(new Error(errorMsg), "", "");
      return {} as ReturnType<typeof childProcess.execFile>;
    },
  );
}

describe("PlannotatorReviewUIAdapter", () => {
  const adapter = new PlannotatorReviewUIAdapter("/usr/local/bin/plannotator");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("presentFindings", () => {
    it("invokes plannotator annotate via CLI subprocess (AC4)", async () => {
      mockExecFile("# File Feedback\n\n## 1. General\n> lgtm\n");
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
      expect(childProcess.execFile).toHaveBeenCalledWith(
        "/usr/local/bin/plannotator",
        expect.arrayContaining(["annotate"]),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("degrades to acknowledged on error (AC12)", async () => {
      mockExecFileError("plannotator crashed");
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
      if (result.ok) expect(result.data.acknowledged).toBe(true);
    });
  });

  describe("presentVerification", () => {
    it("invokes plannotator annotate (AC4)", async () => {
      mockExecFile("No feedback provided.");
      const ctx = {
        sliceId: "s1",
        sliceLabel: "M05-S05",
        criteria: [{ criterion: "AC1", verdict: "PASS" as const, evidence: "ok" }],
        overallVerdict: "PASS" as const,
      };
      const result = await adapter.presentVerification(ctx);
      expect(isOk(result)).toBe(true);
      expect(childProcess.execFile).toHaveBeenCalled();
    });

    it("degrades to accepted on error (AC13)", async () => {
      mockExecFileError("crash");
      const ctx = {
        sliceId: "s1",
        sliceLabel: "M05-S05",
        criteria: [],
        overallVerdict: "PASS" as const,
      };
      const result = await adapter.presentVerification(ctx);
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.accepted).toBe(true);
    });
  });

  describe("presentForApproval", () => {
    it("invokes plannotator annotate on artifact path (AC4)", async () => {
      mockExecFile("# File Feedback\n\n## 1. General\n> lgtm\n");
      const ctx = {
        sliceId: "s1",
        sliceLabel: "M05-S05",
        artifactType: "spec" as const,
        artifactPath: "/path/SPEC.md",
        summary: "spec",
      };
      const result = await adapter.presentForApproval(ctx);
      expect(isOk(result)).toBe(true);
      expect(childProcess.execFile).toHaveBeenCalledWith(
        "/usr/local/bin/plannotator",
        ["annotate", "/path/SPEC.md"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("returns approved when feedback has no changes", async () => {
      mockExecFile("User reviewed the document and has no feedback.");
      const ctx = {
        sliceId: "s1",
        sliceLabel: "M05-S05",
        artifactType: "plan" as const,
        artifactPath: "/path/PLAN.md",
        summary: "plan",
      };
      const result = await adapter.presentForApproval(ctx);
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.decision).toBe("approved");
    });

    it("returns changes_requested when feedback has REPLACEMENT/DELETION", async () => {
      mockExecFile("# File Feedback\n## 1. Line 5\n[REPLACEMENT] fix this\n");
      const ctx = {
        sliceId: "s1",
        sliceLabel: "M05-S05",
        artifactType: "spec" as const,
        artifactPath: "/path/SPEC.md",
        summary: "spec",
      };
      const result = await adapter.presentForApproval(ctx);
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.decision).toBe("changes_requested");
    });

    it("degrades to changes_requested on crash — never auto-approves (AC11)", async () => {
      mockExecFileError("crash");
      const ctx = {
        sliceId: "s1",
        sliceLabel: "M05-S05",
        artifactType: "spec" as const,
        artifactPath: "/path/SPEC.md",
        summary: "spec",
      };
      const result = await adapter.presentForApproval(ctx);
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("changes_requested");
        expect(result.data.feedback).toContain("parse error");
      }
    });
  });
});

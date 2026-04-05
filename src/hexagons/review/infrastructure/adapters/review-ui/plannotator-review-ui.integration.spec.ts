import { execFileSync } from "node:child_process";
import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { PlannotatorReviewUIAdapter } from "./plannotator-review-ui.adapter";

const SKIP = !process.env.TFF_INTEGRATION_PLANNOTATOR;

describe.skipIf(SKIP)("PlannotatorReviewUIAdapter — real plannotator (AC9)", () => {
  function detectPlannotator(): string {
    return execFileSync("which", ["plannotator"], { encoding: "utf-8" }).trim();
  }

  it("produces valid FindingsUIResponse", async () => {
    const adapter = new PlannotatorReviewUIAdapter(detectPlannotator());
    const result = await adapter.presentFindings({
      sliceId: "integration-test",
      sliceLabel: "TEST-S01",
      verdict: "approved",
      findings: [],
      conflicts: [],
      fixCyclesUsed: 0,
      timedOutReviewers: [],
    });
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.data.acknowledged).toBe(true);
      expect(result.data.formattedOutput.length).toBeGreaterThan(0);
    }
  });
});

import { describe, expect, it } from "vitest";
import type { AgentStatusReport } from "../schemas/agent-status.schema";
import { crossCheckAgentResult } from "./agent-status-cross-checker";

const ALL_PASSED_DIMS = [
  { dimension: "completeness" as const, passed: true },
  { dimension: "quality" as const, passed: true },
  { dimension: "discipline" as const, passed: true },
  { dimension: "verification" as const, passed: true },
];

function makeReport(overrides?: Partial<AgentStatusReport>): AgentStatusReport {
  return {
    status: "DONE",
    concerns: [],
    selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
    ...overrides,
  };
}

function makeTransport(overrides?: Record<string, unknown>) {
  return {
    filesChanged: ["src/file.ts"],
    durationMs: 5000,
    cost: {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.01,
    },
    error: undefined as string | undefined,
    ...overrides,
  };
}

describe("crossCheckAgentResult", () => {
  it("returns valid when no discrepancies", () => {
    const result = crossCheckAgentResult(makeReport(), makeTransport(), "tff-fixer");
    expect(result.valid).toBe(true);
    expect(result.discrepancies).toEqual([]);
  });

  it("flags completeness-passed + no filesChanged for fixer", () => {
    const result = crossCheckAgentResult(
      makeReport(),
      makeTransport({ filesChanged: [] }),
      "tff-fixer",
    );
    expect(result.valid).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].area).toBe("files-claim");
  });

  it("does NOT flag empty filesChanged for non-fixer agents", () => {
    const result = crossCheckAgentResult(
      makeReport(),
      makeTransport({ filesChanged: [] }),
      "tff-code-reviewer",
    );
    expect(result.valid).toBe(true);
  });

  it("flags DONE with populated error", () => {
    const result = crossCheckAgentResult(
      makeReport(),
      makeTransport({ error: "Something went wrong" }),
      "tff-fixer",
    );
    expect(result.valid).toBe(false);
    expect(result.discrepancies[0].area).toBe("error-consistency");
  });

  it("flags DONE with non-empty concerns", () => {
    const report = makeReport({
      status: "DONE",
      concerns: [{ area: "test", description: "Flaky", severity: "warning" }],
    });
    const result = crossCheckAgentResult(report, makeTransport(), "tff-fixer");
    expect(result.valid).toBe(false);
    expect(result.discrepancies[0].area).toBe("concern-consistency");
  });

  it("does NOT flag DONE_WITH_CONCERNS with concerns", () => {
    const report = makeReport({
      status: "DONE_WITH_CONCERNS",
      concerns: [{ area: "test", description: "Flaky", severity: "warning" }],
    });
    const result = crossCheckAgentResult(report, makeTransport(), "tff-fixer");
    expect(result.discrepancies.every((d) => d.area !== "concern-consistency")).toBe(true);
  });

  it("flags zero duration with non-zero tokens", () => {
    const result = crossCheckAgentResult(
      makeReport(),
      makeTransport({ durationMs: 0 }),
      "tff-fixer",
    );
    expect(result.valid).toBe(false);
    expect(result.discrepancies[0].area).toBe("cost-sanity");
  });

  it("flags zero cost with non-zero tokens", () => {
    const result = crossCheckAgentResult(
      makeReport(),
      makeTransport({
        cost: {
          provider: "anthropic",
          modelId: "m",
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0,
        },
      }),
      "tff-fixer",
    );
    expect(result.valid).toBe(false);
    expect(result.discrepancies[0].area).toBe("cost-sanity");
  });
});

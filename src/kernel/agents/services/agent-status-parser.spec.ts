import { describe, expect, it } from "vitest";
import { AgentStatusParseError } from "../errors/agent-status-parse.error";
import { parseAgentStatusReport } from "./agent-status-parser";

const VALID_REPORT = JSON.stringify({
  status: "DONE",
  concerns: [],
  selfReview: {
    dimensions: [
      { dimension: "completeness", passed: true },
      { dimension: "quality", passed: true },
      { dimension: "discipline", passed: true },
      { dimension: "verification", passed: true },
    ],
    overallConfidence: "high",
  },
});

function wrap(json: string): string {
  return `Some agent output...\n<!-- TFF_STATUS_REPORT -->\n${json}\n<!-- /TFF_STATUS_REPORT -->`;
}

describe("parseAgentStatusReport", () => {
  it("extracts valid report from output", () => {
    const result = parseAgentStatusReport(wrap(VALID_REPORT));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("DONE");
      expect(result.data.selfReview.overallConfidence).toBe("high");
    }
  });

  it("extracts report with concerns", () => {
    const json = JSON.stringify({
      status: "DONE_WITH_CONCERNS",
      concerns: [{ area: "tests", description: "Flaky test", severity: "warning" }],
      selfReview: {
        dimensions: [
          { dimension: "completeness", passed: true },
          { dimension: "quality", passed: true },
          { dimension: "discipline", passed: true },
          { dimension: "verification", passed: false, note: "Flaky test observed" },
        ],
        overallConfidence: "medium",
      },
    });
    const result = parseAgentStatusReport(wrap(json));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("DONE_WITH_CONCERNS");
      expect(result.data.concerns).toHaveLength(1);
    }
  });

  it("returns error when markers are missing", () => {
    const result = parseAgentStatusReport("Just some output without markers");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AgentStatusParseError);
      expect(result.error.code).toBe("AGENT_STATUS.PARSE_FAILED");
      expect(result.error.rawOutput).toContain("without markers");
    }
  });

  it("returns error when JSON is malformed", () => {
    const result = parseAgentStatusReport(wrap("{ not valid json }"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AgentStatusParseError);
    }
  });

  it("returns error when JSON does not match schema", () => {
    const result = parseAgentStatusReport(wrap('{ "status": "INVALID" }'));
    expect(result.ok).toBe(false);
  });

  it("handles extra text around markers", () => {
    const output = `I've completed the task.\n\n<!-- TFF_STATUS_REPORT -->\n${VALID_REPORT}\n<!-- /TFF_STATUS_REPORT -->\n\nHope this helps!`;
    const result = parseAgentStatusReport(output);
    expect(result.ok).toBe(true);
  });

  it("preserves raw output in error", () => {
    const raw = "No markers here at all";
    const result = parseAgentStatusReport(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.rawOutput).toBe(raw);
    }
  });
});

import { describe, expect, it } from "vitest";
import { AGENT_STATUS_PROMPT } from "./agent-status-prompt";

describe("AGENT_STATUS_PROMPT", () => {
  it("contains all four status definitions", () => {
    expect(AGENT_STATUS_PROMPT).toContain("DONE");
    expect(AGENT_STATUS_PROMPT).toContain("DONE_WITH_CONCERNS");
    expect(AGENT_STATUS_PROMPT).toContain("NEEDS_CONTEXT");
    expect(AGENT_STATUS_PROMPT).toContain("BLOCKED");
  });

  it("contains self-review checklist dimensions", () => {
    expect(AGENT_STATUS_PROMPT).toContain("completeness");
    expect(AGENT_STATUS_PROMPT).toContain("quality");
    expect(AGENT_STATUS_PROMPT).toContain("discipline");
    expect(AGENT_STATUS_PROMPT).toContain("verification");
  });

  it("contains JSON output format with markers", () => {
    expect(AGENT_STATUS_PROMPT).toContain("TFF_STATUS_REPORT");
    expect(AGENT_STATUS_PROMPT).toContain("/TFF_STATUS_REPORT");
  });

  it("contains never-report-DONE-with-concerns rule", () => {
    expect(AGENT_STATUS_PROMPT).toContain("Never report DONE if you have unresolved concerns");
  });
});

import { describe, expect, it } from "vitest";
import { buildResearchProtocolMessage } from "./research-protocol";

describe("buildResearchProtocolMessage", () => {
  const params = {
    sliceId: "uuid-123",
    sliceLabel: "M03-S06",
    sliceTitle: "Research command",
    sliceDescription: "Agent-dispatched research",
    milestoneLabel: "M03",
    milestoneId: "ms-uuid",
    specContent: "# Spec Content\n\nSome spec...",
    autonomyMode: "plan-to-pr",
    nextStep: "Auto-invoke /tff plan M03-S06",
  };

  it("should include slice context", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("M03-S06");
    expect(msg).toContain("Research command");
    expect(msg).toContain("uuid-123");
    expect(msg).toContain("ms-uuid");
  });

  it("should embed SPEC.md content", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("# Spec Content");
    expect(msg).toContain("Some spec...");
  });

  it("should contain all three phases", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("Phase 1");
    expect(msg).toContain("Phase 2");
    expect(msg).toContain("Phase 3");
  });

  it("should contain RESEARCH.md section structure", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("Questions Investigated");
    expect(msg).toContain("Codebase Findings");
    expect(msg).toContain("Technical Risks");
    expect(msg).toContain("Recommendations for Planning");
  });

  it("should reference tff_write_research tool", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("tff_write_research");
  });

  it("should reference tff_workflow_transition tool", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("tff_workflow_transition");
  });

  it("includes nextStep text in output", () => {
    const msg = buildResearchProtocolMessage({
      ...params,
      nextStep: "Next: /tff plan M03-S06",
    });
    expect(msg).toContain("Next: /tff plan M03-S06");
  });
});

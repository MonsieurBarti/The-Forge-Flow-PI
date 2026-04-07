import { describe, expect, it } from "vitest";
import { AgentCardSchema } from "../schemas/agent-card.schema";
import { createAgentTemplate } from "./agent-template";
import { AgentValidationService } from "./agent-validation.service";

describe("createAgentTemplate", () => {
  it("produces valid .agent.md content", () => {
    const content = createAgentTemplate("tff-fixer", {
      displayName: "Fixer",
      purpose: "Fix things",
      scope: "task",
      capabilities: ["fix"],
      modelProfile: "budget",
      freshReviewerRule: "none",
      skills: [{ name: "standard", prompt: "prompts/standard-review.md", strategy: "standard" }],
    });

    expect(content).toContain("---");
    expect(content).toContain("type: tff-fixer");
    expect(content).toContain("displayName: Fixer");
  });

  it("output passes AgentValidationService", () => {
    const content = createAgentTemplate("tff-code-reviewer", {
      displayName: "Code Reviewer",
      purpose: "Review code",
      scope: "slice",
      capabilities: ["review"],
      modelProfile: "quality",
      freshReviewerRule: "must-not-be-executor",
      skills: [{ name: "ctr", prompt: "prompts/ctr.md", strategy: "critique-then-reflection" }],
    });

    // Parse the generated content through the same pipeline the loader uses
    const lines = content.split("\n");
    const firstDash = lines.indexOf("---");
    const secondDash = lines.indexOf("---", firstDash + 1);
    const body = lines
      .slice(secondDash + 1)
      .join("\n")
      .trim();

    expect(body.split("\n").length).toBeLessThanOrEqual(30);

    const service = new AgentValidationService();
    const card = AgentCardSchema.parse({
      type: "tff-code-reviewer",
      displayName: "Code Reviewer",
      description: "Review code",
      identity: body,
      purpose: "Review code",
      scope: "slice",
      freshReviewerRule: "must-not-be-executor",
      capabilities: ["review"],
      defaultModelProfile: "quality",
      skills: [{ name: "ctr", prompt: "prompts/ctr.md", strategy: "critique-then-reflection" }],
      requiredTools: [],
      optionalTools: [],
    });
    const result = service.validate(card);
    expect(result.ok).toBe(true);
  });

  it("uses placeholder identity when none provided", () => {
    const content = createAgentTemplate("tff-fixer", {
      displayName: "Fixer",
      purpose: "Fix things",
      scope: "task",
      capabilities: ["fix"],
      modelProfile: "budget",
      freshReviewerRule: "none",
    });

    expect(content).toContain("You are a Fixer");
  });

  it("uses custom identity when provided", () => {
    const content = createAgentTemplate("tff-fixer", {
      displayName: "Fixer",
      purpose: "Fix things",
      scope: "task",
      capabilities: ["fix"],
      modelProfile: "budget",
      freshReviewerRule: "none",
      identity: "Custom identity text here.",
    });

    expect(content).toContain("Custom identity text here.");
  });
});

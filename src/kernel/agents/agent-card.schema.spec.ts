import { describe, expect, it } from "vitest";
import { AgentCapabilitySchema, AgentCardSchema, AgentTypeSchema } from "./agent-card.schema";

describe("AgentTypeSchema", () => {
  it("accepts valid agent types", () => {
    expect(AgentTypeSchema.parse("spec-reviewer")).toBe("spec-reviewer");
    expect(AgentTypeSchema.parse("code-reviewer")).toBe("code-reviewer");
    expect(AgentTypeSchema.parse("security-auditor")).toBe("security-auditor");
    expect(AgentTypeSchema.parse("fixer")).toBe("fixer");
    expect(AgentTypeSchema.parse("executor")).toBe("executor");
  });

  it("rejects unknown agent type", () => {
    expect(() => AgentTypeSchema.parse("brainstormer")).toThrow();
  });
});

describe("AgentCapabilitySchema", () => {
  it("accepts valid capabilities", () => {
    expect(AgentCapabilitySchema.parse("review")).toBe("review");
    expect(AgentCapabilitySchema.parse("fix")).toBe("fix");
    expect(AgentCapabilitySchema.parse("execute")).toBe("execute");
  });

  it("rejects unknown capability", () => {
    expect(() => AgentCapabilitySchema.parse("design")).toThrow();
  });
});

describe("AgentCardSchema", () => {
  it("parses a valid agent card", () => {
    const card = AgentCardSchema.parse({
      type: "code-reviewer",
      displayName: "Code Reviewer",
      description: "Reviews code for correctness, patterns, and security",
      capabilities: ["review"],
      defaultModelProfile: "quality",
      requiredTools: ["Read", "Glob", "Grep"],
    });
    expect(card.type).toBe("code-reviewer");
    expect(card.optionalTools).toEqual([]);
  });

  it("rejects card with empty capabilities", () => {
    expect(() =>
      AgentCardSchema.parse({
        type: "code-reviewer",
        displayName: "Code Reviewer",
        description: "Reviews code",
        capabilities: [],
        defaultModelProfile: "quality",
        requiredTools: [],
      }),
    ).toThrow();
  });

  it("rejects card with invalid model profile", () => {
    expect(() =>
      AgentCardSchema.parse({
        type: "code-reviewer",
        displayName: "Code Reviewer",
        description: "Reviews code",
        capabilities: ["review"],
        defaultModelProfile: "premium",
        requiredTools: [],
      }),
    ).toThrow();
  });
});

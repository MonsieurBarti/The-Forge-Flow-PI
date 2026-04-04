import { describe, expect, it } from "vitest";
import {
  AgentCapabilitySchema,
  AgentCardSchema,
  AgentSkillSchema,
  AgentTypeSchema,
} from "./agent-card.schema";

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
      identity: "You are a senior code reviewer.",
      purpose: "Review code changes for quality",
      scope: "slice",
      freshReviewerRule: "must-not-be-executor",
      capabilities: ["review"],
      defaultModelProfile: "quality",
      skills: [{ name: "ctr", prompt: "prompts/ctr.md", strategy: "critique-then-reflection" }],
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
        identity: "You are a senior code reviewer.",
        purpose: "Review code changes for quality",
        scope: "slice",
        freshReviewerRule: "must-not-be-executor",
        capabilities: [],
        defaultModelProfile: "quality",
        skills: [{ name: "ctr", prompt: "prompts/ctr.md", strategy: "critique-then-reflection" }],
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
        identity: "You are a senior code reviewer.",
        purpose: "Review code changes for quality",
        scope: "slice",
        freshReviewerRule: "must-not-be-executor",
        capabilities: ["review"],
        defaultModelProfile: "premium",
        skills: [{ name: "ctr", prompt: "prompts/ctr.md", strategy: "critique-then-reflection" }],
        requiredTools: [],
      }),
    ).toThrow();
  });
});

describe("AgentSkillSchema", () => {
  it("accepts valid skill", () => {
    const skill = AgentSkillSchema.parse({
      name: "critique-then-reflection",
      prompt: "prompts/critique-then-reflection.md",
      strategy: "critique-then-reflection",
    });
    expect(skill.name).toBe("critique-then-reflection");
  });

  it("rejects missing name", () => {
    expect(() => AgentSkillSchema.parse({ prompt: "p.md", strategy: "standard" })).toThrow();
  });

  it("rejects invalid strategy", () => {
    expect(() =>
      AgentSkillSchema.parse({ name: "x", prompt: "p.md", strategy: "unknown" }),
    ).toThrow();
  });
});

describe("AgentCardSchema (extended)", () => {
  const validCard = {
    type: "code-reviewer",
    displayName: "Code Reviewer",
    description: "Reviews code",
    identity: "You are a senior code reviewer.",
    purpose: "Review code changes for quality",
    scope: "slice",
    freshReviewerRule: "must-not-be-executor",
    capabilities: ["review"],
    defaultModelProfile: "quality",
    skills: [{ name: "ctr", prompt: "prompts/ctr.md", strategy: "critique-then-reflection" }],
    requiredTools: ["Read", "Glob", "Grep"],
  };

  it("parses a fully populated card", () => {
    const card = AgentCardSchema.parse(validCard);
    expect(card.type).toBe("code-reviewer");
    expect(card.identity).toBe("You are a senior code reviewer.");
    expect(card.purpose).toBe("Review code changes for quality");
    expect(card.scope).toBe("slice");
    expect(card.freshReviewerRule).toBe("must-not-be-executor");
    expect(card.skills).toHaveLength(1);
    expect(card.optionalTools).toEqual([]);
  });

  it("rejects card missing identity", () => {
    const { identity: _, ...noIdentity } = validCard;
    expect(() => AgentCardSchema.parse(noIdentity)).toThrow();
  });

  it("rejects card missing purpose", () => {
    const { purpose: _, ...noPurpose } = validCard;
    expect(() => AgentCardSchema.parse(noPurpose)).toThrow();
  });

  it("rejects card missing scope", () => {
    const { scope: _, ...noScope } = validCard;
    expect(() => AgentCardSchema.parse(noScope)).toThrow();
  });

  it("rejects card missing skills", () => {
    const { skills: _, ...noSkills } = validCard;
    expect(() => AgentCardSchema.parse(noSkills)).toThrow();
  });

  it("rejects card missing freshReviewerRule", () => {
    const { freshReviewerRule: _, ...noRule } = validCard;
    expect(() => AgentCardSchema.parse(noRule)).toThrow();
  });

  it("retains defaultModelProfile field name", () => {
    const card = AgentCardSchema.parse(validCard);
    expect(card.defaultModelProfile).toBe("quality");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentCard, AgentType } from "./agent-card.schema";
import { AgentTypeSchema } from "./agent-card.schema";
import {
  AgentRegistry,
  findAgentsByCapability,
  getAgentCard,
  initializeAgentRegistry,
  resetAgentRegistry,
} from "./agent-registry";

function makeTestCard(type: AgentType): AgentCard {
  return {
    type,
    displayName: type,
    description: `Agent: ${type}`,
    identity: `You are a ${type}.`,
    purpose: `Purpose of ${type}`,
    scope: "slice",
    freshReviewerRule: type === "fixer" || type === "executor" ? "none" : "must-not-be-executor",
    capabilities:
      type === "fixer"
        ? ["fix"]
        : type === "executor"
          ? ["execute"]
          : type === "verifier"
            ? ["verify"]
            : ["review"],
    defaultModelProfile: type === "fixer" || type === "executor" ? "budget" : "quality",
    skills: [{ name: "std", prompt: "prompts/std.md", strategy: "standard" }],
    requiredTools: ["Read"],
    optionalTools: [],
  };
}

function makeTestCards(): Map<AgentType, AgentCard> {
  const cards = new Map<AgentType, AgentCard>();
  for (const type of AgentTypeSchema.options) {
    cards.set(type, makeTestCard(type));
  }
  return cards;
}

describe("AgentRegistry", () => {
  describe("fromCards", () => {
    it("creates registry queryable by get()", () => {
      const registry = AgentRegistry.fromCards(makeTestCards());
      const card = registry.get("code-reviewer");
      expect(card?.type).toBe("code-reviewer");
    });

    it("has() returns true for known types", () => {
      const registry = AgentRegistry.fromCards(makeTestCards());
      expect(registry.has("fixer")).toBe(true);
    });

    it("has() returns false for unknown types", () => {
      const registry = AgentRegistry.fromCards(new Map());
      expect(registry.has("fixer")).toBe(false);
    });

    it("getAll() returns all cards", () => {
      const registry = AgentRegistry.fromCards(makeTestCards());
      expect(registry.getAll().size).toBe(6);
    });
  });
});

describe("backward-compat wrappers", () => {
  beforeEach(() => {
    initializeAgentRegistry(AgentRegistry.fromCards(makeTestCards()));
  });

  afterEach(() => {
    resetAgentRegistry();
  });

  it("getAgentCard returns card for valid type", () => {
    const card = getAgentCard("spec-reviewer");
    expect(card.type).toBe("spec-reviewer");
  });

  it("getAgentCard throws for missing type in registry", () => {
    initializeAgentRegistry(AgentRegistry.fromCards(new Map()));
    expect(() => getAgentCard("spec-reviewer")).toThrow(/Missing registry entry/);
  });

  it("findAgentsByCapability returns review agents", () => {
    const agents = findAgentsByCapability("review");
    expect(agents.length).toBe(3);
    for (const a of agents) expect(a.capabilities).toContain("review");
  });

  it("getAll() returns all cards via registry instance", () => {
    const registry = AgentRegistry.fromCards(makeTestCards());
    expect(registry.getAll().size).toBe(6);
  });
});

describe("before initialization", () => {
  beforeEach(() => {
    resetAgentRegistry();
  });

  it("getAgentCard throws AgentRegistryError.notLoaded", () => {
    expect(() => getAgentCard("fixer")).toThrow(/before initialization/);
  });
});

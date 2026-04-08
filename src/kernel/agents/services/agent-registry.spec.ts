import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentCard, AgentType } from "../schemas/agent-card.schema";
import { AgentTypeSchema } from "../schemas/agent-card.schema";
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
    freshReviewerRule:
      type === "tff-fixer" || type === "tff-executor" ? "none" : "must-not-be-executor",
    capabilities:
      type === "tff-fixer"
        ? ["fix"]
        : type === "tff-executor"
          ? ["execute"]
          : type === "tff-verifier"
            ? ["verify"]
            : ["review"],
    defaultModelProfile: type === "tff-fixer" || type === "tff-executor" ? "budget" : "quality",
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
      const card = registry.get("tff-code-reviewer");
      expect(card?.type).toBe("tff-code-reviewer");
    });

    it("has() returns true for known types", () => {
      const registry = AgentRegistry.fromCards(makeTestCards());
      expect(registry.has("tff-fixer")).toBe(true);
    });

    it("has() returns false for unknown types", () => {
      const registry = AgentRegistry.fromCards(new Map());
      expect(registry.has("tff-fixer")).toBe(false);
    });

    it("getAll() returns all cards", () => {
      const registry = AgentRegistry.fromCards(makeTestCards());
      expect(registry.getAll().size).toBe(7);
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
    const card = getAgentCard("tff-spec-reviewer");
    expect(card.type).toBe("tff-spec-reviewer");
  });

  it("getAgentCard throws for missing type in registry", () => {
    initializeAgentRegistry(AgentRegistry.fromCards(new Map()));
    expect(() => getAgentCard("tff-spec-reviewer")).toThrow(/Missing registry entry/);
  });

  it("findAgentsByCapability returns review agents", () => {
    const agents = findAgentsByCapability("review");
    expect(agents.length).toBe(4);
    for (const a of agents) expect(a.capabilities).toContain("review");
  });

  it("getAll() returns all cards via registry instance", () => {
    const registry = AgentRegistry.fromCards(makeTestCards());
    expect(registry.getAll().size).toBe(7);
  });
});

describe("before initialization", () => {
  beforeEach(() => {
    resetAgentRegistry();
  });

  it("getAgentCard throws AgentRegistryError.notLoaded", () => {
    expect(() => getAgentCard("tff-fixer")).toThrow(/before initialization/);
  });
});

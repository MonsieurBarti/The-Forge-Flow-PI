import { describe, expect, it } from "vitest";
import { AgentTypeSchema } from "./agent-card.schema";
import type { AgentType } from "./agent-card.schema";
import {
  AGENT_REGISTRY,
  findAgentsByCapability,
  getAgentCard,
} from "./agent-registry";

describe("AGENT_REGISTRY", () => {
  it("has an entry for every AgentType enum value", () => {
    const allTypes = AgentTypeSchema.options;
    for (const agentType of allTypes) {
      expect(
        AGENT_REGISTRY.has(agentType),
        `Missing registry entry for "${agentType}"`,
      ).toBe(true);
    }
  });

  it("has no extra entries beyond AgentType enum", () => {
    const allTypes = new Set<string>(AgentTypeSchema.options);
    for (const key of AGENT_REGISTRY.keys()) {
      expect(allTypes.has(key), `Unexpected registry entry "${key}"`).toBe(
        true,
      );
    }
  });
});

describe("getAgentCard", () => {
  it("returns the card for a valid agent type", () => {
    const card = getAgentCard("spec-reviewer");
    expect(card.type).toBe("spec-reviewer");
    expect(card.capabilities.length).toBeGreaterThan(0);
  });

  it("returns correct card for each agent type", () => {
    const allTypes: readonly AgentType[] = AgentTypeSchema.options;
    for (const agentType of allTypes) {
      const card = getAgentCard(agentType);
      expect(card.type).toBe(agentType);
    }
  });
});

describe("findAgentsByCapability", () => {
  it("returns agents with the review capability", () => {
    const agents = findAgentsByCapability("review");
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(agent.capabilities).toContain("review");
    }
  });

  it("returns agents with the fix capability", () => {
    const agents = findAgentsByCapability("fix");
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(agent.capabilities).toContain("fix");
    }
  });
});

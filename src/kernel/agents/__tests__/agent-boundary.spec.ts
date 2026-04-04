import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentTypeSchema } from "../schemas/agent-card.schema";
import { AgentResourceLoader } from "../services/agent-resource-loader";
import { AgentValidationService } from "../services/agent-validation.service";

const RESOURCES_DIR = join(import.meta.dirname, "../../../resources");

describe("Agent boundary enforcement", () => {
  const loader = new AgentResourceLoader();
  const validator = new AgentValidationService();

  it("loads all agent files without errors", () => {
    const result = loader.loadAll(RESOURCES_DIR);
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
  });

  it("all 6 agents are present (migration guard)", () => {
    const result = loader.loadAll(RESOURCES_DIR);
    if (!result.ok) throw new Error(result.error.message);
    const types = [...result.data.keys()];
    for (const expected of AgentTypeSchema.options) {
      expect(types, `Missing agent: ${expected}`).toContain(expected);
    }
    expect(types).toHaveLength(6);
  });

  it("every agent passes validation", () => {
    const result = loader.loadAll(RESOURCES_DIR);
    if (!result.ok) throw new Error(result.error.message);
    for (const [type, card] of result.data) {
      const validation = validator.validate(card);
      expect(
        validation.ok,
        `${type} failed validation: ${!validation.ok ? validation.error.message : ""}`,
      ).toBe(true);
    }
  });

  it("every agent identity is <=30 lines", () => {
    const result = loader.loadAll(RESOURCES_DIR);
    if (!result.ok) throw new Error(result.error.message);
    for (const [type, card] of result.data) {
      const lines = card.identity.split("\n").length;
      expect(lines, `${type} identity has ${lines} lines`).toBeLessThanOrEqual(30);
    }
  });
});

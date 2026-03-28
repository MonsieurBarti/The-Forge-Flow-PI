import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { AgentDispatchConfigSchema, ResolvedModelSchema } from "./agent-dispatch.schema";

describe("ResolvedModelSchema", () => {
  it("parses valid model", () => {
    const model = ResolvedModelSchema.parse({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
    expect(model.provider).toBe("anthropic");
  });

  it("rejects empty provider", () => {
    expect(() =>
      ResolvedModelSchema.parse({ provider: "", modelId: "claude-sonnet-4-6" }),
    ).toThrow();
  });
});

describe("AgentDispatchConfigSchema", () => {
  it("parses valid dispatch config", () => {
    const config = AgentDispatchConfigSchema.parse({
      taskId: faker.string.uuid(),
      sliceId: faker.string.uuid(),
      agentType: "fixer",
      workingDirectory: "/tmp/work",
      systemPrompt: "You are a backend developer.",
      taskPrompt: "Implement the feature.",
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      tools: ["Read", "Write", "Bash"],
    });
    expect(config.filePaths).toEqual([]);
    expect(config.tools).toHaveLength(3);
  });

  it("rejects config with empty tools array", () => {
    expect(() =>
      AgentDispatchConfigSchema.parse({
        taskId: faker.string.uuid(),
        sliceId: faker.string.uuid(),
        agentType: "fixer",
        workingDirectory: "/tmp/work",
        systemPrompt: "",
        taskPrompt: "Do it.",
        model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
        tools: [],
      }),
    ).toThrow();
  });

  it("rejects config with invalid agentType", () => {
    expect(() =>
      AgentDispatchConfigSchema.parse({
        taskId: faker.string.uuid(),
        sliceId: faker.string.uuid(),
        agentType: "wizard",
        workingDirectory: "/tmp/work",
        systemPrompt: "",
        taskPrompt: "Do it.",
        model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
        tools: ["Read"],
      }),
    ).toThrow();
  });
});

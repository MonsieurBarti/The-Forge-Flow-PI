import { describe, expect, it } from "vitest";
import { AgentDispatchConfigBuilder } from "./agent-dispatch.builder";
import { AgentDispatchConfigSchema } from "./agent-dispatch.schema";

describe("AgentDispatchConfigBuilder", () => {
  it("builds valid config with defaults", () => {
    const config = new AgentDispatchConfigBuilder().build();
    expect(() => AgentDispatchConfigSchema.parse(config)).not.toThrow();
  });

  it("overrides taskId", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const config = new AgentDispatchConfigBuilder().withTaskId(id).build();
    expect(config.taskId).toBe(id);
  });

  it("overrides agentType", () => {
    const config = new AgentDispatchConfigBuilder().withAgentType("code-reviewer").build();
    expect(config.agentType).toBe("code-reviewer");
  });

  it("overrides model", () => {
    const config = new AgentDispatchConfigBuilder()
      .withModel({ provider: "openai", modelId: "gpt-4" })
      .build();
    expect(config.model.provider).toBe("openai");
  });

  it("overrides filePaths", () => {
    const config = new AgentDispatchConfigBuilder()
      .withFilePaths(["src/foo.ts", "src/bar.ts"])
      .build();
    expect(config.filePaths).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("is chainable", () => {
    const config = new AgentDispatchConfigBuilder()
      .withAgentType("spec-reviewer")
      .withWorkingDirectory("/workspace")
      .withSystemPrompt("Review the spec.")
      .withTaskPrompt("Check completeness.")
      .withTools(["Read", "Glob"])
      .build();
    expect(config.agentType).toBe("spec-reviewer");
    expect(config.workingDirectory).toBe("/workspace");
  });
});

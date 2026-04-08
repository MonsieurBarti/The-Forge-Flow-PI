import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DomainRouter } from "./domain-router";
import { PromptBuilder } from "./prompt-builder";

const templateContent = readFileSync(
  join(process.cwd(), "src/resources/protocols/execute.md"),
  "utf-8",
);

describe("PromptBuilder", () => {
  const config = {
    sliceId: randomUUID(),
    sliceLabel: "M04-S07",
    sliceTitle: "Wave-based execution engine",
    milestoneId: randomUUID(),
    workingDirectory: "/path/to/worktree",
    model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
    complexity: "F-full" as const,
  };
  const router = new DomainRouter();
  const builder = new PromptBuilder(config, router, templateContent);

  const task = {
    id: randomUUID(),
    label: "T01",
    title: "Test task",
    description: "Implement feature X",
    acceptanceCriteria: "AC1: Feature X works",
    filePaths: ["src/hexagons/execution/domain/foo.ts"],
  };

  it("sets agentType to executor", () => {
    const result = builder.build(task);
    expect(result.agentType).toBe("tff-executor");
  });

  it("includes workingDirectory from config", () => {
    const result = builder.build(task);
    expect(result.workingDirectory).toBe("/path/to/worktree");
  });

  it("includes task filePaths", () => {
    const result = builder.build(task);
    expect(result.filePaths).toEqual(task.filePaths);
  });

  it("systemPrompt contains skill XML tags from DomainRouter", () => {
    const result = builder.build(task);
    expect(result.systemPrompt).toContain('<skill name="');
    expect(result.systemPrompt).toContain("executing-plans");
  });

  it("systemPrompt does NOT include AGENT_STATUS_PROMPT", () => {
    const result = builder.build(task);
    expect(result.systemPrompt).not.toContain("Status Reporting Protocol");
    expect(result.systemPrompt).not.toContain("TFF_STATUS_REPORT");
  });

  it("taskPrompt contains task title and description", () => {
    const result = builder.build(task);
    expect(result.taskPrompt).toContain("Test task");
    expect(result.taskPrompt).toContain("Implement feature X");
  });

  it("taskPrompt contains compressed notation symbols from template", () => {
    const result = builder.build(task);
    expect(result.taskPrompt).toMatch(/[∀⇒¬∧]/);
  });

  it("taskPrompt contains slice label and task label", () => {
    const result = builder.build(task);
    expect(result.taskPrompt).toContain("M04-S07");
    expect(result.taskPrompt).toContain("T01");
  });

  it("includes model from config", () => {
    const result = builder.build(task);
    expect(result.model).toEqual(config.model);
  });

  it("includes standard tool set", () => {
    const result = builder.build(task);
    expect(result.tools).toEqual(["Read", "Write", "Edit", "Bash", "Glob", "Grep"]);
  });

  it("includes taskId and sliceId", () => {
    const result = builder.build(task);
    expect(result.taskId).toBe(task.id);
    expect(result.sliceId).toBe(config.sliceId);
  });
});

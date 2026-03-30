import type { AgentDispatchConfig, ComplexityTier, ResolvedModel } from "@kernel";
import type { DomainRouter } from "./domain-router";

export interface PromptBuilderConfig {
  readonly sliceId: string;
  readonly sliceLabel: string;
  readonly sliceTitle: string;
  readonly milestoneId: string;
  readonly workingDirectory: string;
  readonly model: ResolvedModel;
  readonly complexity: ComplexityTier;
}

export interface PromptBuilderTask {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly filePaths: readonly string[];
}

export class PromptBuilder {
  constructor(
    private readonly config: PromptBuilderConfig,
    private readonly router: DomainRouter,
    private readonly templateContent: string,
  ) {}

  build(task: PromptBuilderTask): AgentDispatchConfig {
    const skills = this.router.resolve(task.filePaths);
    return {
      taskId: task.id,
      sliceId: this.config.sliceId,
      agentType: "executor",
      workingDirectory: this.config.workingDirectory,
      systemPrompt: this.buildSystemPrompt(skills),
      taskPrompt: this.interpolateTemplate(task),
      model: this.config.model,
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      filePaths: [...task.filePaths],
    };
  }

  private buildSystemPrompt(skills: string[]): string {
    return skills.map((s) => `<skill name="${s}" />`).join("\n");
  }

  private interpolateTemplate(task: PromptBuilderTask): string {
    return this.templateContent
      .replace(/\{\{sliceLabel\}\}/g, this.config.sliceLabel)
      .replace(/\{\{sliceTitle\}\}/g, this.config.sliceTitle)
      .replace(/\{\{sliceId\}\}/g, this.config.sliceId)
      .replace(/\{\{complexity\}\}/g, this.config.complexity)
      .replace(/\{\{workingDirectory\}\}/g, this.config.workingDirectory)
      .replace(/\{\{taskLabel\}\}/g, task.label)
      .replace(/\{\{taskTitle\}\}/g, task.title)
      .replace(/\{\{taskDescription\}\}/g, task.description)
      .replace(/\{\{acceptanceCriteria\}\}/g, task.acceptanceCriteria)
      .replace(/\{\{filePaths\}\}/g, task.filePaths.map((f) => `- \`${f}\``).join("\n"));
  }
}

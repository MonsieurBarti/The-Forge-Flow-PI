import { faker } from "@faker-js/faker";
import type { AgentType } from "./agent-card.schema";
import type { AgentDispatchConfig, ResolvedModel } from "./agent-dispatch.schema";
import { AgentDispatchConfigSchema } from "./agent-dispatch.schema";

export class AgentDispatchConfigBuilder {
  private _taskId: string = faker.string.uuid();
  private _sliceId: string = faker.string.uuid();
  private _agentType: AgentType = "fixer";
  private _workingDirectory = "/tmp/test-workspace";
  private _systemPrompt: string = faker.lorem.paragraph();
  private _taskPrompt: string = faker.lorem.paragraph();
  private _model: ResolvedModel = {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
  };
  private _tools: string[] = ["Read", "Write", "Bash"];
  private _filePaths: string[] = [];

  withTaskId(taskId: string): this {
    this._taskId = taskId;
    return this;
  }
  withSliceId(sliceId: string): this {
    this._sliceId = sliceId;
    return this;
  }
  withAgentType(agentType: AgentType): this {
    this._agentType = agentType;
    return this;
  }
  withWorkingDirectory(dir: string): this {
    this._workingDirectory = dir;
    return this;
  }
  withSystemPrompt(prompt: string): this {
    this._systemPrompt = prompt;
    return this;
  }
  withTaskPrompt(prompt: string): this {
    this._taskPrompt = prompt;
    return this;
  }
  withModel(model: ResolvedModel): this {
    this._model = model;
    return this;
  }
  withTools(tools: string[]): this {
    this._tools = tools;
    return this;
  }
  withFilePaths(paths: string[]): this {
    this._filePaths = paths;
    return this;
  }

  build(): AgentDispatchConfig {
    return AgentDispatchConfigSchema.parse({
      taskId: this._taskId,
      sliceId: this._sliceId,
      agentType: this._agentType,
      workingDirectory: this._workingDirectory,
      systemPrompt: this._systemPrompt,
      taskPrompt: this._taskPrompt,
      model: this._model,
      tools: this._tools,
      filePaths: this._filePaths,
    });
  }
}

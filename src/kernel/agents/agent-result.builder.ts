import { faker } from "@faker-js/faker";
import type { AgentType } from "./agent-card.schema";
import type { AgentCost, AgentResult } from "./agent-result.schema";
import { AgentResultSchema } from "./agent-result.schema";

export class AgentResultBuilder {
  private _taskId: string = faker.string.uuid();
  private _agentType: AgentType = "fixer";
  private _success = true;
  private _output: string = faker.lorem.paragraph();
  private _filesChanged: string[] = [];
  private _cost: AgentCost = {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    inputTokens: faker.number.int({ min: 100, max: 10000 }),
    outputTokens: faker.number.int({ min: 50, max: 5000 }),
    costUsd: Number.parseFloat(faker.finance.amount({ min: 0.001, max: 1, dec: 4 })),
  };
  private _durationMs: number = faker.number.int({ min: 1000, max: 120000 });
  private _error?: string;

  withTaskId(taskId: string): this {
    this._taskId = taskId;
    return this;
  }
  withAgentType(agentType: AgentType): this {
    this._agentType = agentType;
    return this;
  }
  withSuccess(success: boolean): this {
    this._success = success;
    return this;
  }
  withOutput(output: string): this {
    this._output = output;
    return this;
  }
  withFilesChanged(files: string[]): this {
    this._filesChanged = files;
    return this;
  }
  withCost(cost: AgentCost): this {
    this._cost = cost;
    return this;
  }
  withDurationMs(ms: number): this {
    this._durationMs = ms;
    return this;
  }
  withError(error: string): this {
    this._error = error;
    return this;
  }

  withFailure(error: string): this {
    this._success = false;
    this._error = error;
    return this;
  }

  build(): AgentResult {
    return AgentResultSchema.parse({
      taskId: this._taskId,
      agentType: this._agentType,
      success: this._success,
      output: this._output,
      filesChanged: this._filesChanged,
      cost: this._cost,
      durationMs: this._durationMs,
      error: this._error,
    });
  }
}

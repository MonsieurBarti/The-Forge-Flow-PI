import { faker } from "@faker-js/faker";
import type { AgentType } from "./agent-card.schema";
import type { AgentCost, AgentResult } from "./agent-result.schema";
import { AgentResultSchema } from "./agent-result.schema";
import type { AgentConcern, AgentStatus, SelfReviewChecklist } from "./agent-status.schema";
import type { TurnMetrics } from "./turn-metrics.schema";

const DEFAULT_SELF_REVIEW: SelfReviewChecklist = {
  dimensions: [
    { dimension: "completeness", passed: true },
    { dimension: "quality", passed: true },
    { dimension: "discipline", passed: true },
    { dimension: "verification", passed: true },
  ],
  overallConfidence: "high",
};

export class AgentResultBuilder {
  private _taskId: string = faker.string.uuid();
  private _agentType: AgentType = "fixer";
  private _status: AgentStatus = "DONE";
  private _output: string = faker.lorem.paragraph();
  private _filesChanged: string[] = [];
  private _concerns: AgentConcern[] = [];
  private _selfReview: SelfReviewChecklist = DEFAULT_SELF_REVIEW;
  private _cost: AgentCost = {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    inputTokens: faker.number.int({ min: 100, max: 10000 }),
    outputTokens: faker.number.int({ min: 50, max: 5000 }),
    costUsd: Number.parseFloat(faker.finance.amount({ min: 0.001, max: 1, dec: 4 })),
  };
  private _durationMs: number = faker.number.int({ min: 1000, max: 120000 });
  private _error?: string;
  private _turns: TurnMetrics[] = [];

  withTaskId(taskId: string): this {
    this._taskId = taskId;
    return this;
  }
  withAgentType(agentType: AgentType): this {
    this._agentType = agentType;
    return this;
  }
  withStatus(status: AgentStatus): this {
    this._status = status;
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
  withConcerns(concerns: AgentConcern[]): this {
    this._concerns = concerns;
    return this;
  }
  withSelfReview(selfReview: SelfReviewChecklist): this {
    this._selfReview = selfReview;
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
  withTurns(turns: TurnMetrics[]): this {
    this._turns = turns;
    return this;
  }

  asDone(): this {
    this._status = "DONE";
    return this;
  }
  asDoneWithConcerns(concerns: AgentConcern[]): this {
    this._status = "DONE_WITH_CONCERNS";
    this._concerns = concerns;
    return this;
  }
  asBlocked(error: string): this {
    this._status = "BLOCKED";
    this._error = error;
    return this;
  }
  asNeedsContext(error: string): this {
    this._status = "NEEDS_CONTEXT";
    this._error = error;
    return this;
  }

  build(): AgentResult {
    return AgentResultSchema.parse({
      taskId: this._taskId,
      agentType: this._agentType,
      status: this._status,
      output: this._output,
      filesChanged: this._filesChanged,
      concerns: this._concerns,
      selfReview: this._selfReview,
      cost: this._cost,
      durationMs: this._durationMs,
      turns: this._turns,
      error: this._error,
    });
  }
}

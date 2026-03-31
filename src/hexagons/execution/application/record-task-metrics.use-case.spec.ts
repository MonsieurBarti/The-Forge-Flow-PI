import { InProcessEventBus, isOk, SilentLoggerAdapter } from "@kernel";
import { AgentResultBuilder } from "@kernel/agents";
import { beforeEach, describe, expect, it } from "vitest";
import { TaskExecutionCompletedEvent } from "../domain/events/task-execution-completed.event";
import { InMemoryMetricsRepository } from "../infrastructure/in-memory-metrics.repository";
import { RecordTaskMetricsUseCase } from "./record-task-metrics.use-case";

describe("RecordTaskMetricsUseCase", () => {
  let repo: InMemoryMetricsRepository;
  let bus: InProcessEventBus;
  let useCase: RecordTaskMetricsUseCase;

  beforeEach(() => {
    repo = new InMemoryMetricsRepository();
    bus = new InProcessEventBus(new SilentLoggerAdapter());
    useCase = new RecordTaskMetricsUseCase(repo);
    useCase.register(bus);
  });

  it("transforms AgentResult into TaskMetrics and persists (AC2)", async () => {
    const sliceId = crypto.randomUUID();
    const milestoneId = crypto.randomUUID();
    const agentResult = new AgentResultBuilder()
      .withCost({
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
      })
      .build();

    await bus.publish(
      new TaskExecutionCompletedEvent({
        id: crypto.randomUUID(),
        aggregateId: crypto.randomUUID(),
        occurredAt: new Date(),
        taskId: agentResult.taskId,
        sliceId,
        milestoneId,
        waveIndex: 0,
        modelProfile: "balanced",
        agentResult,
      }),
    );

    const result = await repo.readAll();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(1);
      const metrics = result.data[0];
      expect(metrics.taskId).toBe(agentResult.taskId);
      expect(metrics.sliceId).toBe(sliceId);
      expect(metrics.milestoneId).toBe(milestoneId);
      expect(metrics.model.provider).toBe("anthropic");
      expect(metrics.model.modelId).toBe("claude-sonnet-4-6");
      expect(metrics.model.profile).toBe("balanced");
      expect(metrics.tokens.input).toBe(1000);
      expect(metrics.tokens.output).toBe(500);
      expect(metrics.costUsd).toBe(0.05);
      expect(metrics.success).toBe(
        agentResult.status === "DONE" || agentResult.status === "DONE_WITH_CONCERNS",
      );
      expect(metrics.durationMs).toBe(agentResult.durationMs);
      expect(metrics.retries).toBe(0);
      expect(metrics.downshifted).toBe(false);
    }
  });

  it("records failed dispatches too (AC1)", async () => {
    const agentResult = new AgentResultBuilder().asBlocked("timeout").build();

    await bus.publish(
      new TaskExecutionCompletedEvent({
        id: crypto.randomUUID(),
        aggregateId: crypto.randomUUID(),
        occurredAt: new Date(),
        taskId: agentResult.taskId,
        sliceId: crypto.randomUUID(),
        milestoneId: crypto.randomUUID(),
        waveIndex: 1,
        modelProfile: "quality",
        agentResult,
      }),
    );

    const result = await repo.readAll();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].success).toBe(false); // BLOCKED maps to success=false
    }
  });
});

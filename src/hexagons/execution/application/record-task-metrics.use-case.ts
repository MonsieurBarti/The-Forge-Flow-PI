import { type DomainEvent, EVENT_NAMES, type EventBusPort } from "@kernel";
import { isSuccessfulStatus } from "@kernel/agents";
import { TaskExecutionCompletedEvent } from "../domain/events/task-execution-completed.event";
import type { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";
import type { TaskMetrics } from "../domain/task-metrics.schemas";

export class RecordTaskMetricsUseCase {
  constructor(private readonly metricsRepo: MetricsRepositoryPort) {}

  register(eventBus: EventBusPort): void {
    eventBus.subscribe(EVENT_NAMES.TASK_EXECUTION_COMPLETED, (event) =>
      this.onTaskExecutionCompleted(event),
    );
  }

  private async onTaskExecutionCompleted(event: DomainEvent): Promise<void> {
    if (!(event instanceof TaskExecutionCompletedEvent)) return;

    const metrics: TaskMetrics = {
      taskId: event.taskId,
      sliceId: event.sliceId,
      milestoneId: event.milestoneId,
      model: {
        provider: event.agentResult.cost.provider,
        modelId: event.agentResult.cost.modelId,
        profile: event.modelProfile,
      },
      tokens: {
        input: event.agentResult.cost.inputTokens,
        output: event.agentResult.cost.outputTokens,
      },
      costUsd: event.agentResult.cost.costUsd,
      durationMs: event.agentResult.durationMs,
      success: isSuccessfulStatus(event.agentResult.status),
      retries: 0,
      downshifted: false,
      reflectionPassed: undefined,
      timestamp: event.occurredAt,
    };

    const result = await this.metricsRepo.append(metrics);
    if (!result.ok) {
      console.warn(`[tff] metrics write failed: ${result.error.message}`);
    }
  }
}

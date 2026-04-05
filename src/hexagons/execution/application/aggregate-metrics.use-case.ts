import { ok, type PersistenceError, type Result } from "@kernel";
import type { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";
import type {
  AggregatedMetrics,
  ModelBreakdownEntry,
  TaskMetrics,
} from "../domain/task-metrics.schemas";

export class AggregateMetricsUseCase {
  constructor(private readonly metricsRepo: MetricsRepositoryPort) {}

  async aggregateBySlice(sliceId: string): Promise<Result<AggregatedMetrics, PersistenceError>> {
    const result = await this.metricsRepo.readBySlice(sliceId);
    if (!result.ok) return result;
    return ok(this.aggregate(result.data, { sliceId }));
  }

  async aggregateByMilestone(
    milestoneId: string,
  ): Promise<Result<AggregatedMetrics, PersistenceError>> {
    const result = await this.metricsRepo.readByMilestone(milestoneId);
    if (!result.ok) return result;
    return ok(this.aggregate(result.data, { milestoneId }));
  }

  async aggregateByPhase(
    sliceId: string,
  ): Promise<Result<Record<string, AggregatedMetrics>, PersistenceError>> {
    const result = await this.metricsRepo.readBySlice(sliceId);
    if (!result.ok) return result;

    const groups = new Map<string, TaskMetrics[]>();
    for (const entry of result.data) {
      const phase = entry.phase ?? "unknown";
      const list = groups.get(phase) ?? [];
      list.push(entry);
      groups.set(phase, list);
    }

    const aggregated: Record<string, AggregatedMetrics> = {};
    for (const [phase, entries] of groups) {
      aggregated[phase] = this.aggregate(entries, { sliceId });
    }
    return ok(aggregated);
  }

  private aggregate(
    entries: TaskMetrics[],
    groupKey: { sliceId?: string; milestoneId?: string },
  ): AggregatedMetrics {
    const totalCostUsd = entries.reduce((sum, e) => sum + e.costUsd, 0);
    const totalInputTokens = entries.reduce((sum, e) => sum + e.tokens.input, 0);
    const totalOutputTokens = entries.reduce((sum, e) => sum + e.tokens.output, 0);
    const totalDurationMs = entries.reduce((sum, e) => sum + e.durationMs, 0);
    const taskCount = entries.length;
    const successCount = entries.filter((e) => e.success).length;
    const failureCount = taskCount - successCount;
    const averageCostPerTask = taskCount > 0 ? totalCostUsd / taskCount : 0;

    const modelMap = new Map<string, { taskCount: number; totalCostUsd: number }>();
    for (const entry of entries) {
      const existing = modelMap.get(entry.model.modelId) ?? {
        taskCount: 0,
        totalCostUsd: 0,
      };
      modelMap.set(entry.model.modelId, {
        taskCount: existing.taskCount + 1,
        totalCostUsd: existing.totalCostUsd + entry.costUsd,
      });
    }
    const modelBreakdown: ModelBreakdownEntry[] = [...modelMap.entries()].map(
      ([modelId, data]) => ({ modelId, ...data }),
    );

    return {
      groupKey,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      totalDurationMs,
      taskCount,
      successCount,
      failureCount,
      averageCostPerTask,
      modelBreakdown,
    };
  }
}

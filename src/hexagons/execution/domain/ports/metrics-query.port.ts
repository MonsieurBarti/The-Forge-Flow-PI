import type { PersistenceError, Result } from "@kernel";
import type { AggregatedMetrics } from "../task-metrics.schemas";

export abstract class MetricsQueryPort {
  abstract aggregateBySlice(sliceId: string): Promise<Result<AggregatedMetrics, PersistenceError>>;
  abstract aggregateByMilestone(
    milestoneId: string,
  ): Promise<Result<AggregatedMetrics, PersistenceError>>;
}

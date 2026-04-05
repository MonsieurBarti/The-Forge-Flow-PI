import type { PersistenceError, Result } from "@kernel";
import type { MetricsEntry, QualitySnapshot, TaskMetrics } from "../task-metrics.schemas";

export abstract class MetricsRepositoryPort {
  abstract append(entry: MetricsEntry): Promise<Result<void, PersistenceError>>;
  abstract readBySlice(sliceId: string): Promise<Result<TaskMetrics[], PersistenceError>>;
  abstract readByMilestone(milestoneId: string): Promise<Result<TaskMetrics[], PersistenceError>>;
  abstract readAll(): Promise<Result<MetricsEntry[], PersistenceError>>;
  abstract readQualitySnapshots(
    sliceId: string,
  ): Promise<Result<QualitySnapshot[], PersistenceError>>;
}

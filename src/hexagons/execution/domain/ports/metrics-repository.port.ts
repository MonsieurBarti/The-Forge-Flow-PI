import type { PersistenceError, Result } from "@kernel";
import type { TaskMetrics } from "../task-metrics.schemas";

export abstract class MetricsRepositoryPort {
  abstract append(entry: TaskMetrics): Promise<Result<void, PersistenceError>>;
  abstract readBySlice(sliceId: string): Promise<Result<TaskMetrics[], PersistenceError>>;
  abstract readByMilestone(milestoneId: string): Promise<Result<TaskMetrics[], PersistenceError>>;
  abstract readAll(): Promise<Result<TaskMetrics[], PersistenceError>>;
}

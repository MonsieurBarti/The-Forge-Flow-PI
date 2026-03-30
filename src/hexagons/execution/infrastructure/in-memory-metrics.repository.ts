import type { PersistenceError } from "@kernel";
import { ok, type Result } from "@kernel";
import { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";
import type { TaskMetrics } from "../domain/task-metrics.schemas";

export class InMemoryMetricsRepository extends MetricsRepositoryPort {
  private store: TaskMetrics[] = [];

  async append(entry: TaskMetrics): Promise<Result<void, PersistenceError>> {
    this.store.push(entry);
    return ok(undefined);
  }

  async readBySlice(sliceId: string): Promise<Result<TaskMetrics[], PersistenceError>> {
    return ok(this.store.filter((e) => e.sliceId === sliceId));
  }

  async readByMilestone(milestoneId: string): Promise<Result<TaskMetrics[], PersistenceError>> {
    return ok(this.store.filter((e) => e.milestoneId === milestoneId));
  }

  async readAll(): Promise<Result<TaskMetrics[], PersistenceError>> {
    return ok([...this.store]);
  }

  seed(entries: TaskMetrics[]): void {
    this.store.push(...entries);
  }

  reset(): void {
    this.store = [];
  }
}

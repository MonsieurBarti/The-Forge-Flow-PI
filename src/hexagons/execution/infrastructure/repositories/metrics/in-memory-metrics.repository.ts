import type { PersistenceError } from "@kernel";
import { ok, type Result } from "@kernel";
import { MetricsRepositoryPort } from "../../../domain/ports/metrics-repository.port";
import type {
  MetricsEntry,
  QualitySnapshot,
  TaskMetrics,
} from "../../../domain/task-metrics.schemas";

export class InMemoryMetricsRepository extends MetricsRepositoryPort {
  private store: MetricsEntry[] = [];

  async append(entry: MetricsEntry): Promise<Result<void, PersistenceError>> {
    this.store.push(entry);
    return ok(undefined);
  }

  async readBySlice(sliceId: string): Promise<Result<TaskMetrics[], PersistenceError>> {
    return ok(
      this.store.filter(
        (e): e is TaskMetrics => e.type === "task-metrics" && e.sliceId === sliceId,
      ),
    );
  }

  async readByMilestone(milestoneId: string): Promise<Result<TaskMetrics[], PersistenceError>> {
    return ok(
      this.store.filter(
        (e): e is TaskMetrics => e.type === "task-metrics" && e.milestoneId === milestoneId,
      ),
    );
  }

  async readAll(): Promise<Result<MetricsEntry[], PersistenceError>> {
    return ok([...this.store]);
  }

  async readQualitySnapshots(
    sliceId: string,
  ): Promise<Result<QualitySnapshot[], PersistenceError>> {
    return ok(
      this.store.filter(
        (e): e is QualitySnapshot => e.type === "quality-snapshot" && e.sliceId === sliceId,
      ),
    );
  }

  seed(entries: MetricsEntry[]): void {
    this.store.push(...entries);
  }

  reset(): void {
    this.store = [];
  }
}

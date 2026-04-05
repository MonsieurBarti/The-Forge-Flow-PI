import { unlinkSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { err, ok, PersistenceError, type Result } from "@kernel";
import { MetricsRepositoryPort } from "../../../domain/ports/metrics-repository.port";
import type {
  MetricsEntry,
  QualitySnapshot,
  TaskMetrics,
} from "../../../domain/task-metrics.schemas";
import { QualitySnapshotSchema, TaskMetricsSchema } from "../../../domain/task-metrics.schemas";

function isNodeError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false;
  if (!("code" in error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined && typeof descriptor.value === "string";
}

function serializeEntry(entry: MetricsEntry): string {
  return JSON.stringify({
    ...entry,
    timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp,
  });
}

function parseEntry(raw: Record<string, unknown>): MetricsEntry | null {
  if (raw.type === "quality-snapshot") {
    const parsed = QualitySnapshotSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
  // "task-metrics" or missing type → backward compat
  const parsed = TaskMetricsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export class JsonlMetricsRepository extends MetricsRepositoryPort {
  constructor(private readonly filePath: string) {
    super();
  }

  async append(entry: MetricsEntry): Promise<Result<void, PersistenceError>> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${serializeEntry(entry)}\n`, "utf-8");
      return ok(undefined);
    } catch (error: unknown) {
      return err(new PersistenceError(error instanceof Error ? error.message : String(error)));
    }
  }

  async readAll(): Promise<Result<MetricsEntry[], PersistenceError>> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") return ok([]);
      return err(new PersistenceError(error instanceof Error ? error.message : String(error)));
    }
    const lines = content.split("\n").filter((l) => l.trim());
    const entries: MetricsEntry[] = [];
    for (const line of lines) {
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        const entry = parseEntry(raw);
        if (entry) {
          entries.push(entry);
        }
      } catch {
        // Skip unparseable JSON lines
      }
    }
    return ok(entries);
  }

  async readBySlice(sliceId: string): Promise<Result<TaskMetrics[], PersistenceError>> {
    const result = await this.readAll();
    if (!result.ok) return result;
    return ok(
      result.data.filter(
        (e): e is TaskMetrics => e.type === "task-metrics" && e.sliceId === sliceId,
      ),
    );
  }

  async readByMilestone(milestoneId: string): Promise<Result<TaskMetrics[], PersistenceError>> {
    const result = await this.readAll();
    if (!result.ok) return result;
    return ok(
      result.data.filter(
        (e): e is TaskMetrics => e.type === "task-metrics" && e.milestoneId === milestoneId,
      ),
    );
  }

  async readQualitySnapshots(
    sliceId: string,
  ): Promise<Result<QualitySnapshot[], PersistenceError>> {
    const result = await this.readAll();
    if (!result.ok) return result;
    return ok(
      result.data.filter(
        (e): e is QualitySnapshot => e.type === "quality-snapshot" && e.sliceId === sliceId,
      ),
    );
  }

  reset(): void {
    try {
      unlinkSync(this.filePath);
    } catch {
      // File may not exist
    }
  }
}

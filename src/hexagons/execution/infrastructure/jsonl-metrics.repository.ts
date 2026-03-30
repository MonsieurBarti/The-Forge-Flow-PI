import { unlinkSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { err, ok, type Result } from "@kernel";
import { PersistenceError } from "@kernel";
import type { TaskMetrics } from "../domain/task-metrics.schemas";
import { TaskMetricsSchema } from "../domain/task-metrics.schemas";
import { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";

function isNodeError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false;
  if (!("code" in error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined && typeof descriptor.value === "string";
}

function serializeEntry(entry: TaskMetrics): string {
  return JSON.stringify({
    ...entry,
    timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp,
  });
}

export class JsonlMetricsRepository extends MetricsRepositoryPort {
  constructor(private readonly filePath: string) {
    super();
  }

  async append(entry: TaskMetrics): Promise<Result<void, PersistenceError>> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${serializeEntry(entry)}\n`, "utf-8");
      return ok(undefined);
    } catch (error: unknown) {
      return err(new PersistenceError(error instanceof Error ? error.message : String(error)));
    }
  }

  async readAll(): Promise<Result<TaskMetrics[], PersistenceError>> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") return ok([]);
      return err(new PersistenceError(error instanceof Error ? error.message : String(error)));
    }
    const lines = content.split("\n").filter((l) => l.trim());
    const entries: TaskMetrics[] = [];
    for (const line of lines) {
      try {
        const raw: unknown = JSON.parse(line);
        const parsed = TaskMetricsSchema.safeParse(raw);
        if (parsed.success) {
          entries.push(parsed.data);
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
    return ok(result.data.filter((e) => e.sliceId === sliceId));
  }

  async readByMilestone(milestoneId: string): Promise<Result<TaskMetrics[], PersistenceError>> {
    const result = await this.readAll();
    if (!result.ok) return result;
    return ok(result.data.filter((e) => e.milestoneId === milestoneId));
  }

  reset(): void {
    try {
      unlinkSync(this.filePath);
    } catch {
      // File may not exist
    }
  }
}

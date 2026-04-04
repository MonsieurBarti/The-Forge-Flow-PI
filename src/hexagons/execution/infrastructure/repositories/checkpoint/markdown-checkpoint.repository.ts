import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, PersistenceError, type Result } from "@kernel";
import { Checkpoint } from "../../../domain/checkpoint.aggregate";
import { type CheckpointProps, CheckpointPropsSchema } from "../../../domain/checkpoint.schemas";
import { CheckpointRepositoryPort } from "../../../domain/ports/checkpoint-repository.port";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class MarkdownCheckpointRepository extends CheckpointRepositoryPort {
  constructor(
    private readonly basePath: string,
    private readonly resolveSlicePath: (
      sliceId: string,
    ) => Promise<Result<string, PersistenceError>>,
  ) {
    super();
  }

  async save(checkpoint: Checkpoint): Promise<Result<void, PersistenceError>> {
    const pathResult = await this.resolveSlicePath(checkpoint.sliceId);
    if (!pathResult.ok) return pathResult;

    const filePath = join(this.basePath, pathResult.data, "CHECKPOINT.md");
    const tmpPath = `${filePath}.tmp`;
    const props = checkpoint.toJSON();

    // Preserve session-data block written by MarkdownExecutionSessionAdapter
    let sessionBlock = "";
    try {
      const existing = await readFile(filePath, "utf-8");
      const sessionMatch = existing.match(/<!-- session-data: [\s\S]*? -->/);
      if (sessionMatch) {
        sessionBlock = sessionMatch[0];
      }
    } catch {
      // File does not exist yet — no session block to preserve
    }

    const sessionSuffix = sessionBlock ? `\n${sessionBlock}\n` : "";
    const content = `${this.renderMarkdown(props)}${sessionSuffix}`;

    try {
      await writeFile(tmpPath, content, "utf-8");
      await rename(tmpPath, filePath);
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Failed to write checkpoint: ${filePath}: ${message}`));
    }
  }

  async findBySliceId(sliceId: string): Promise<Result<Checkpoint | null, PersistenceError>> {
    const pathResult = await this.resolveSlicePath(sliceId);
    if (!pathResult.ok) return pathResult;

    const filePath = join(this.basePath, pathResult.data, "CHECKPOINT.md");
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return ok(null);
      }
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Failed to read checkpoint: ${filePath}: ${message}`));
    }

    const jsonMatch = content.match(/<!-- CHECKPOINT_JSON\n([\s\S]*?)\n-->/);
    if (!jsonMatch) {
      return err(
        new PersistenceError(`Corrupt CHECKPOINT.md: missing JSON comment in ${filePath}`),
      );
    }

    try {
      const raw = JSON.parse(jsonMatch[1]);
      raw.createdAt = new Date(raw.createdAt);
      raw.updatedAt = new Date(raw.updatedAt);
      for (const entry of raw.executorLog) {
        entry.startedAt = new Date(entry.startedAt);
        if (entry.completedAt !== null) {
          entry.completedAt = new Date(entry.completedAt);
        }
      }
      const props = CheckpointPropsSchema.parse(raw);
      return ok(Checkpoint.reconstitute(props));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(
        new PersistenceError(`Corrupt CHECKPOINT.md: invalid JSON in ${filePath}: ${message}`),
      );
    }
  }

  async delete(sliceId: string): Promise<Result<void, PersistenceError>> {
    const pathResult = await this.resolveSlicePath(sliceId);
    if (!pathResult.ok) return pathResult;

    const filePath = join(this.basePath, pathResult.data, "CHECKPOINT.md");
    try {
      await unlink(filePath);
    } catch (error: unknown) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return ok(undefined);
      }
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Failed to delete checkpoint: ${filePath}: ${message}`));
    }
    return ok(undefined);
  }

  reset(): void {
    // No-op: tests use temp directories with unique sliceIds per test
  }

  private renderMarkdown(props: CheckpointProps): string {
    const completedWavesStr =
      props.completedWaves.length > 0 ? props.completedWaves.join(", ") : "none";

    const logRows = props.executorLog
      .map((e) => {
        const started = e.startedAt.toISOString().slice(11, 16);
        const completed = e.completedAt ? e.completedAt.toISOString().slice(11, 16) : "---";
        return `| ${e.taskId.slice(0, 8)} | ${e.agentIdentity} | ${started} | ${completed} |`;
      })
      .join("\n");

    const logTable =
      props.executorLog.length > 0
        ? `## Executor Log\n\n| Task | Agent | Started | Completed |\n|------|-------|---------|----------|\n${logRows}`
        : "## Executor Log\n\nNo entries.";

    const json = JSON.stringify(props);

    return [
      `# Checkpoint -- ${props.sliceId.slice(0, 8)}`,
      "",
      `- **Slice:** ${props.sliceId}`,
      `- **Base Commit:** ${props.baseCommit}`,
      `- **Current Wave:** ${props.currentWaveIndex}`,
      `- **Completed Waves:** ${completedWavesStr}`,
      `- **Completed Tasks:** ${props.completedTasks.length}`,
      "",
      logTable,
      "",
      `<!-- CHECKPOINT_JSON`,
      json,
      `-->`,
      "",
    ].join("\n");
  }
}

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, PersistenceError, type Result } from "@kernel";
import { ExecutionSession } from "../domain/execution-session.aggregate";
import { ExecutionSessionPropsSchema } from "../domain/execution-session.schemas";
import { ExecutionSessionRepositoryPort } from "../domain/ports/execution-session-repository.port";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

const SESSION_DATA_REGEX = /<!-- session-data: ([\s\S]*?) -->/;

export class MarkdownExecutionSessionAdapter extends ExecutionSessionRepositoryPort {
  constructor(
    private readonly basePath: string,
    private readonly resolveSlicePath: (
      sliceId: string,
    ) => Promise<Result<string, PersistenceError>>,
  ) {
    super();
  }

  async save(session: ExecutionSession): Promise<Result<void, PersistenceError>> {
    const pathResult = await this.resolveSlicePath(session.sliceId);
    if (!pathResult.ok) return pathResult;

    const filePath = join(this.basePath, pathResult.data, "CHECKPOINT.md");
    const tmpPath = `${filePath}.session.tmp`;
    const sessionJson = JSON.stringify(session.toJSON());

    try {
      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch {
        content = "";
      }

      const sessionBlock = `<!-- session-data: ${sessionJson} -->`;

      if (SESSION_DATA_REGEX.test(content)) {
        content = content.replace(SESSION_DATA_REGEX, sessionBlock);
      } else {
        content = `${content.trimEnd()}\n${sessionBlock}\n`;
      }

      await writeFile(tmpPath, content, "utf-8");
      await rename(tmpPath, filePath);
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Failed to write session: ${filePath}: ${message}`));
    }
  }

  async findBySliceId(sliceId: string): Promise<Result<ExecutionSession | null, PersistenceError>> {
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
      return err(new PersistenceError(`Failed to read session: ${filePath}: ${message}`));
    }

    const match = content.match(SESSION_DATA_REGEX);
    if (!match) return ok(null);

    try {
      const raw = JSON.parse(match[1]);
      raw.createdAt = new Date(raw.createdAt);
      raw.updatedAt = new Date(raw.updatedAt);
      if (raw.startedAt) raw.startedAt = new Date(raw.startedAt);
      if (raw.pausedAt) raw.pausedAt = new Date(raw.pausedAt);
      if (raw.completedAt) raw.completedAt = new Date(raw.completedAt);
      const props = ExecutionSessionPropsSchema.parse(raw);
      return ok(ExecutionSession.reconstitute(props));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Corrupt session data in ${filePath}: ${message}`));
    }
  }

  async delete(sliceId: string): Promise<Result<void, PersistenceError>> {
    const pathResult = await this.resolveSlicePath(sliceId);
    if (!pathResult.ok) return pathResult;

    const filePath = join(this.basePath, pathResult.data, "CHECKPOINT.md");
    try {
      const content = await readFile(filePath, "utf-8");
      const cleaned = `${content.replace(SESSION_DATA_REGEX, "").trimEnd()}\n`;
      await writeFile(filePath, cleaned, "utf-8");
    } catch (error: unknown) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return ok(undefined);
      }
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Failed to delete session: ${filePath}: ${message}`));
    }
    return ok(undefined);
  }
}

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { err, ok, PersistenceError, type Result } from "@kernel";
import {
  type WorkflowJournalEntry,
  WorkflowJournalEntrySchema,
  WorkflowJournalPort,
} from "../domain/ports/workflow-journal.port";

function isNodeError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false;
  if (!("code" in error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined && typeof descriptor.value === "string";
}

export class JsonlWorkflowJournalRepository extends WorkflowJournalPort {
  constructor(private readonly filePath: string) {
    super();
  }

  async append(entry: WorkflowJournalEntry): Promise<Result<void, PersistenceError>> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const serialized = {
        ...entry,
        timestamp:
          entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp,
      };
      await appendFile(this.filePath, `${JSON.stringify(serialized)}\n`, "utf-8");
      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new PersistenceError(
          `Failed to append workflow journal entry: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  async readAll(): Promise<Result<WorkflowJournalEntry[], PersistenceError>> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") return ok([]);
      return err(
        new PersistenceError(
          `Failed to read workflow journal: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }

    const lines = content.split("\n").filter((l) => l.trim());
    const entries: WorkflowJournalEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const raw: unknown = JSON.parse(lines[i]);
        entries.push(WorkflowJournalEntrySchema.parse(raw));
      } catch (error: unknown) {
        return err(
          new PersistenceError(
            `Corrupt workflow journal entry at line ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
    return ok(entries);
  }
}

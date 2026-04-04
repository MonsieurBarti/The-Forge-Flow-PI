import { readdirSync, unlinkSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "@kernel";
import { JournalReadError } from "../../../domain/errors/journal-read.error";
import { JournalWriteError } from "../../../domain/errors/journal-write.error";
import type { JournalEntry } from "../../../domain/journal-entry.schemas";
import { JournalEntrySchema } from "../../../domain/journal-entry.schemas";
import { JournalRepositoryPort } from "../../../domain/ports/journal-repository.port";

function isNodeError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false;
  if (!("code" in error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined && typeof descriptor.value === "string";
}

export class JsonlJournalRepository extends JournalRepositoryPort {
  constructor(private readonly basePath: string) {
    super();
  }

  private filePath(sliceId: string): string {
    return join(this.basePath, `${sliceId}.jsonl`);
  }

  async append(
    sliceId: string,
    entry: Omit<JournalEntry, "seq">,
  ): Promise<Result<number, JournalWriteError>> {
    const countResult = await this.count(sliceId);
    if (!countResult.ok) return err(new JournalWriteError(countResult.error.message));
    const seq = countResult.data;
    const fullEntry = {
      ...entry,
      seq,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp,
    };
    try {
      await mkdir(this.basePath, { recursive: true });
      await appendFile(this.filePath(sliceId), `${JSON.stringify(fullEntry)}\n`, "utf-8");
      return ok(seq);
    } catch (error: unknown) {
      return err(new JournalWriteError(error instanceof Error ? error.message : String(error)));
    }
  }

  async readAll(sliceId: string): Promise<Result<readonly JournalEntry[], JournalReadError>> {
    let content: string;
    try {
      content = await readFile(this.filePath(sliceId), "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") return ok([]);
      return err(new JournalReadError(error instanceof Error ? error.message : String(error)));
    }
    const lines = content.split("\n").filter((l) => l.trim());
    const entries: JournalEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const raw: unknown = JSON.parse(lines[i]);
        entries.push(JournalEntrySchema.parse(raw));
      } catch (error: unknown) {
        return err(
          new JournalReadError(
            `Corrupt entry at line ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
            { lineNumber: i + 1, rawContent: lines[i] },
          ),
        );
      }
    }
    return ok(entries);
  }

  async readSince(
    sliceId: string,
    afterSeq: number,
  ): Promise<Result<readonly JournalEntry[], JournalReadError>> {
    const result = await this.readAll(sliceId);
    if (!result.ok) return result;
    return ok(result.data.filter((e) => e.seq > afterSeq));
  }

  async count(sliceId: string): Promise<Result<number, JournalReadError>> {
    const result = await this.readAll(sliceId);
    if (!result.ok) return result;
    return ok(result.data.length);
  }

  reset(): void {
    try {
      const files = readdirSync(this.basePath);
      for (const file of files) {
        if (file.endsWith(".jsonl")) {
          unlinkSync(join(this.basePath, file));
        }
      }
    } catch (error: unknown) {
      // If basePath doesn't exist yet, there's nothing to reset
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
  }
}

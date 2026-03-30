import { ok, type Result } from "@kernel";
import type { JournalReadError } from "../domain/errors/journal-read.error";
import type { JournalWriteError } from "../domain/errors/journal-write.error";
import { type JournalEntry, JournalEntrySchema } from "../domain/journal-entry.schemas";
import { JournalRepositoryPort } from "../domain/ports/journal-repository.port";

export class InMemoryJournalRepository extends JournalRepositoryPort {
  private store = new Map<string, JournalEntry[]>();

  async append(
    sliceId: string,
    entry: Omit<JournalEntry, "seq">,
  ): Promise<Result<number, JournalWriteError>> {
    const entries = this.store.get(sliceId) ?? [];
    const seq = entries.length;
    const fullEntry = JournalEntrySchema.parse({ ...entry, seq });
    this.store.set(sliceId, [...entries, fullEntry]);
    return ok(seq);
  }

  async readAll(sliceId: string): Promise<Result<readonly JournalEntry[], JournalReadError>> {
    return ok(this.store.get(sliceId) ?? []);
  }

  async readSince(
    sliceId: string,
    afterSeq: number,
  ): Promise<Result<readonly JournalEntry[], JournalReadError>> {
    const entries = this.store.get(sliceId) ?? [];
    return ok(entries.filter((e) => e.seq > afterSeq));
  }

  async count(sliceId: string): Promise<Result<number, JournalReadError>> {
    return ok((this.store.get(sliceId) ?? []).length);
  }

  seed(sliceId: string, entries: JournalEntry[]): void {
    this.store.set(sliceId, entries);
  }

  reset(): void {
    this.store.clear();
  }
}

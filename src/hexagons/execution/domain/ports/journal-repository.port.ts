import type { Result } from "@kernel";
import type { JournalReadError } from "../errors/journal-read.error";
import type { JournalWriteError } from "../errors/journal-write.error";
import type { JournalEntry } from "../journal-entry.schemas";

export abstract class JournalRepositoryPort {
  abstract append(
    sliceId: string,
    entry: Omit<JournalEntry, "seq">,
  ): Promise<Result<number, JournalWriteError>>;
  abstract readAll(sliceId: string): Promise<Result<readonly JournalEntry[], JournalReadError>>;
  abstract readSince(
    sliceId: string,
    afterSeq: number,
  ): Promise<Result<readonly JournalEntry[], JournalReadError>>;
  abstract count(sliceId: string): Promise<Result<number, JournalReadError>>;
}

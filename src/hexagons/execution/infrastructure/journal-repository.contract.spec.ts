import { isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { JournalEntryBuilder } from "../domain/journal-entry.builder";
import type { JournalRepositoryPort } from "../domain/ports/journal-repository.port";

export function runJournalContractTests(
  name: string,
  factory: () => JournalRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: JournalRepositoryPort & { reset(): void };
    const sliceId = crypto.randomUUID();
    const builder = new JournalEntryBuilder().withSliceId(sliceId);

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("append assigns monotonic seq starting at 0 (AC2)", async () => {
      const seq0 = await repo.append(sliceId, builder.buildTaskStarted());
      expect(isOk(seq0)).toBe(true);
      if (isOk(seq0)) expect(seq0.data).toBe(0);

      const seq1 = await repo.append(sliceId, builder.buildTaskCompleted());
      expect(isOk(seq1)).toBe(true);
      if (isOk(seq1)) expect(seq1.data).toBe(1);

      const seq2 = await repo.append(sliceId, builder.buildPhaseChanged());
      expect(isOk(seq2)).toBe(true);
      if (isOk(seq2)) expect(seq2.data).toBe(2);
    });

    it("readAll returns entries in seq order (AC2)", async () => {
      await repo.append(sliceId, builder.buildTaskStarted());
      await repo.append(sliceId, builder.buildTaskCompleted());
      await repo.append(sliceId, builder.buildPhaseChanged());

      const result = await repo.readAll(sliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(3);
        expect(result.data[0].seq).toBe(0);
        expect(result.data[1].seq).toBe(1);
        expect(result.data[2].seq).toBe(2);
      }
    });

    it("readSince filters entries after specified seq (AC9)", async () => {
      for (let i = 0; i < 10; i++) {
        await repo.append(sliceId, builder.buildTaskStarted());
      }

      const result = await repo.readSince(sliceId, 5);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(4); // seq 6,7,8,9
        expect(result.data[0].seq).toBe(6);
        expect(result.data[3].seq).toBe(9);
      }
    });

    it("count matches number of appended entries", async () => {
      await repo.append(sliceId, builder.buildTaskStarted());
      await repo.append(sliceId, builder.buildTaskCompleted());

      const result = await repo.count(sliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe(2);
    });

    it("append to new slice creates entry list", async () => {
      const newSliceId = crypto.randomUUID();
      const newBuilder = new JournalEntryBuilder().withSliceId(newSliceId);
      await repo.append(newSliceId, newBuilder.buildPhaseChanged());

      const result = await repo.readAll(newSliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toHaveLength(1);
    });

    it("readAll returns empty for unknown slice", async () => {
      const result = await repo.readAll(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toHaveLength(0);
    });
  });
}

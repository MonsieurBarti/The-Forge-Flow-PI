import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isErr, isOk } from "@kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JournalEntryBuilder } from "../domain/journal-entry.builder";
import { runJournalContractTests } from "./journal-repository.contract.spec";
import { JsonlJournalRepository } from "./jsonl-journal.repository";

let basePath: string;

beforeAll(async () => {
  basePath = await mkdtemp(join(tmpdir(), "tff-journal-"));
});

afterAll(async () => {
  await rm(basePath, { recursive: true, force: true });
});

runJournalContractTests("JsonlJournalRepository", () => new JsonlJournalRepository(basePath));

describe("JsonlJournalRepository — adapter-specific", () => {
  it("survives process restart (AC1)", async () => {
    const repo1 = new JsonlJournalRepository(basePath);
    const sliceId = crypto.randomUUID();
    const builder = new JournalEntryBuilder().withSliceId(sliceId);
    await repo1.append(sliceId, builder.buildPhaseChanged());

    const repo2 = new JsonlJournalRepository(basePath);
    const result = await repo2.readAll(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toHaveLength(1);
  });

  it("detects corrupted JSONL line with line number (AC10)", async () => {
    const sliceId = crypto.randomUUID();
    const repo = new JsonlJournalRepository(basePath);
    const builder = new JournalEntryBuilder().withSliceId(sliceId);

    // Write a valid entry first so seq 0 is valid
    await repo.append(sliceId, builder.buildPhaseChanged());

    // Manually append a corrupt (truncated JSON) line
    const filePath = join(basePath, `${sliceId}.jsonl`);
    await appendFile(filePath, "{truncated\n", "utf-8");

    const result = await repo.readAll(sliceId);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("JOURNAL.READ_FAILURE");
      expect(result.error.metadata?.lineNumber).toBe(2);
    }
  });
});

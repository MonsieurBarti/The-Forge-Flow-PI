import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { ShipRecord } from "../../../domain/aggregates/ship-record.aggregate";
import { SqliteShipRecordRepository } from "./sqlite-ship-record.repository";

const NOW = new Date("2026-04-02T12:00:00Z");

function makeRecord(params: { id: string; sliceId: string }): ShipRecord {
  return ShipRecord.createNew({
    id: params.id,
    sliceId: params.sliceId,
    prNumber: 42,
    prUrl: "https://github.com/org/repo/pull/42",
    headBranch: "slice/M05-S09",
    baseBranch: "milestone/M05",
    now: NOW,
  });
}

describe("SqliteShipRecordRepository", () => {
  let db: Database.Database;
  let repo: SqliteShipRecordRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    repo = new SqliteShipRecordRepository(db);
  });

  it("save + findBySliceId round-trip", async () => {
    const sliceId = crypto.randomUUID();
    const record = makeRecord({ id: crypto.randomUUID(), sliceId });

    await repo.save(record);

    const result = await repo.findBySliceId(sliceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].toJSON()).toEqual(record.toJSON());
  });

  it("upsert on duplicate id (save, recordMerge, save again -> merged)", async () => {
    const sliceId = crypto.randomUUID();
    const id = crypto.randomUUID();
    const record = makeRecord({ id, sliceId });

    await repo.save(record);

    record.recordMerge(2, NOW);
    await repo.save(record);

    const result = await repo.findBySliceId(sliceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].isMerged).toBe(true);
    expect(result.data[0].toJSON()).toEqual(record.toJSON());
  });

  it("findBySliceId returns empty array for unknown slice", async () => {
    const result = await repo.findBySliceId(crypto.randomUUID());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(0);
  });

  it("findAll returns empty array when no records", async () => {
    const result = await repo.findAll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });

  it("findAll returns all records across slices", async () => {
    const r1 = makeRecord({ id: crypto.randomUUID(), sliceId: crypto.randomUUID() });
    const r2 = makeRecord({ id: crypto.randomUUID(), sliceId: crypto.randomUUID() });
    await repo.save(r1);
    await repo.save(r2);

    const result = await repo.findAll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
  });

  it("reset clears all records", async () => {
    await repo.save(makeRecord({ id: crypto.randomUUID(), sliceId: crypto.randomUUID() }));
    repo.reset();

    const result = await repo.findAll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });
});

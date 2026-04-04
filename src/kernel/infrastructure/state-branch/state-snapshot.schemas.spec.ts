import { describe, expect, it } from "vitest";
import {
  BranchMetaSchema,
  migrateSnapshot,
  SCHEMA_VERSION,
  StateSnapshotSchema,
} from "./state-snapshot.schemas";

describe("StateSnapshotSchema", () => {
  it("parses a valid snapshot", () => {
    const raw = {
      version: 1,
      exportedAt: new Date().toISOString(),
      project: null,
      milestones: [],
      slices: [],
      tasks: [],
      shipRecords: [],
      completionRecords: [],
    };
    const result = StateSnapshotSchema.parse(raw);
    expect(result.version).toBe(1);
    expect(result.project).toBeNull();
    expect(result.milestones).toEqual([]);
  });

  it("applies defaults for missing optional array fields", () => {
    const raw = {
      version: 1,
      exportedAt: new Date().toISOString(),
      project: null,
      milestones: [],
      slices: [],
      tasks: [],
      // shipRecords and completionRecords omitted — Zod defaults kick in
    };
    const result = StateSnapshotSchema.parse(raw);
    expect(result.shipRecords).toEqual([]);
    expect(result.completionRecords).toEqual([]);
  });

  it("rejects invalid version type", () => {
    const raw = {
      version: "bad",
      exportedAt: new Date().toISOString(),
      project: null,
      milestones: [],
      slices: [],
      tasks: [],
    };
    expect(() => StateSnapshotSchema.parse(raw)).toThrow();
  });
});

describe("BranchMetaSchema", () => {
  it("parses valid branch meta", () => {
    const raw = {
      version: 1,
      stateId: crypto.randomUUID(),
      codeBranch: "milestone/M07",
      stateBranch: "tff-state/milestone/M07",
      parentStateBranch: "tff-state/main",
      lastSyncedAt: null,
    };
    const result = BranchMetaSchema.parse(raw);
    expect(result.lastJournalOffset).toBe(0);
    expect(result.dirty).toBe(false);
  });

  it("applies defaults for missing optional fields", () => {
    const raw = {
      version: 1,
      stateId: crypto.randomUUID(),
      codeBranch: "slice/M07-S02",
      stateBranch: "tff-state/slice/M07-S02",
      parentStateBranch: "tff-state/milestone/M07",
      lastSyncedAt: null,
    };
    const result = BranchMetaSchema.parse(raw);
    expect(result.lastJournalOffset).toBe(0);
    expect(result.dirty).toBe(false);
  });

  it("defaults lastSyncedHash to null when field is omitted", () => {
    const raw = {
      version: 1,
      stateId: crypto.randomUUID(),
      codeBranch: "slice/M07-S03",
      stateBranch: "tff-state/slice/M07-S03",
      parentStateBranch: "tff-state/milestone/M07",
      lastSyncedAt: null,
    };
    const result = BranchMetaSchema.parse(raw);
    expect(result.lastSyncedHash).toBeNull();
  });
});

describe("migrateSnapshot", () => {
  it("returns data unchanged when version matches SCHEMA_VERSION", () => {
    const raw = { version: SCHEMA_VERSION, data: "test" };
    const result = migrateSnapshot(raw);
    expect(result.version).toBe(SCHEMA_VERSION);
    expect(result.data).toBe("test");
  });

  it("throws when version > SCHEMA_VERSION", () => {
    const raw = { version: SCHEMA_VERSION + 1 };
    expect(() => migrateSnapshot(raw)).toThrow("newer than supported");
  });
});

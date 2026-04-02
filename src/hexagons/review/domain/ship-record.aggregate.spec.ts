import { describe, expect, it } from "vitest";
import { ShipRecord } from "./ship-record.aggregate";

const NOW = new Date("2026-04-02T12:00:00Z");
const ID = crypto.randomUUID();
const SLICE_ID = crypto.randomUUID();

describe("ShipRecord", () => {
  it("createNew initializes with null outcome", () => {
    const r = ShipRecord.createNew({
      id: ID,
      sliceId: SLICE_ID,
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      headBranch: "slice/M05-S09",
      baseBranch: "milestone/M05",
      now: NOW,
    });
    expect(r.id).toBe(ID);
    expect(r.isMerged).toBe(false);
    expect(r.isAborted).toBe(false);
  });

  it("recordMerge sets outcome to merged", () => {
    const r = ShipRecord.createNew({
      id: ID,
      sliceId: SLICE_ID,
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      headBranch: "slice/M05-S09",
      baseBranch: "milestone/M05",
      now: NOW,
    });
    r.recordMerge(1);
    expect(r.isMerged).toBe(true);
    expect(r.isAborted).toBe(false);
  });

  it("recordAbort sets outcome to aborted", () => {
    const r = ShipRecord.createNew({
      id: ID,
      sliceId: SLICE_ID,
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      headBranch: "slice/M05-S09",
      baseBranch: "milestone/M05",
      now: NOW,
    });
    r.recordAbort();
    expect(r.isAborted).toBe(true);
    expect(r.isMerged).toBe(false);
  });

  it("recordMerge throws if outcome already set", () => {
    const r = ShipRecord.createNew({
      id: ID,
      sliceId: SLICE_ID,
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      headBranch: "slice/M05-S09",
      baseBranch: "milestone/M05",
      now: NOW,
    });
    r.recordAbort();
    expect(() => r.recordMerge(0)).toThrow();
  });

  it("recordAbort throws if outcome already set", () => {
    const r = ShipRecord.createNew({
      id: ID,
      sliceId: SLICE_ID,
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      headBranch: "slice/M05-S09",
      baseBranch: "milestone/M05",
      now: NOW,
    });
    r.recordMerge(0);
    expect(() => r.recordAbort()).toThrow();
  });

  it("reconstitute round-trips via toJSON", () => {
    const r = ShipRecord.createNew({
      id: ID,
      sliceId: SLICE_ID,
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      headBranch: "slice/M05-S09",
      baseBranch: "milestone/M05",
      now: NOW,
    });
    r.recordMerge(2);
    const json = r.toJSON();
    const r2 = ShipRecord.reconstitute(json);
    expect(r2.toJSON()).toEqual(json);
  });
});

import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import {
  MergeGateDecisionSchema,
  ShipRecordPropsSchema,
  ShipRequestSchema,
  ShipResultSchema,
} from "./ship.schemas";

const validUuid = faker.string.uuid();
const otherUuid = faker.string.uuid();

describe("MergeGateDecisionSchema", () => {
  it("accepts 'merged'", () => {
    expect(MergeGateDecisionSchema.parse("merged")).toBe("merged");
  });

  it("accepts 'needs_changes'", () => {
    expect(MergeGateDecisionSchema.parse("needs_changes")).toBe("needs_changes");
  });

  it("accepts 'abort'", () => {
    expect(MergeGateDecisionSchema.parse("abort")).toBe("abort");
  });

  it("rejects unknown values", () => {
    expect(() => MergeGateDecisionSchema.parse("unknown")).toThrow();
  });
});

describe("ShipRecordPropsSchema", () => {
  const validRecord = {
    id: validUuid,
    sliceId: otherUuid,
    prNumber: 42,
    prUrl: "https://github.com/org/repo/pull/42",
    headBranch: "feature/my-branch",
    baseBranch: "main",
    outcome: null,
    fixCyclesUsed: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    completedAt: null,
  };

  it("parses a valid record with null outcome and completedAt", () => {
    const result = ShipRecordPropsSchema.parse(validRecord);
    expect(result.id).toBe(validUuid);
    expect(result.sliceId).toBe(otherUuid);
    expect(result.prNumber).toBe(42);
    expect(result.outcome).toBeNull();
    expect(result.completedAt).toBeNull();
  });

  it("parses a record with a non-null outcome and completedAt", () => {
    const result = ShipRecordPropsSchema.parse({
      ...validRecord,
      outcome: "merged",
      completedAt: new Date("2024-01-02T00:00:00Z"),
    });
    expect(result.outcome).toBe("merged");
    expect(result.completedAt).toBeInstanceOf(Date);
  });

  it("rejects missing required fields", () => {
    const { id: _id, ...withoutId } = validRecord;
    expect(() => ShipRecordPropsSchema.parse(withoutId)).toThrow();
  });

  it("rejects invalid id", () => {
    expect(() => ShipRecordPropsSchema.parse({ ...validRecord, id: "not-a-uuid" })).toThrow();
  });

  it("rejects negative fixCyclesUsed", () => {
    expect(() => ShipRecordPropsSchema.parse({ ...validRecord, fixCyclesUsed: -1 })).toThrow();
  });
});

describe("ShipRequestSchema", () => {
  const validRequest = {
    sliceId: validUuid,
    workingDirectory: "/home/user/project",
    baseBranch: "main",
    headBranch: "feature/ship",
  };

  it("parses a valid request", () => {
    const result = ShipRequestSchema.parse(validRequest);
    expect(result.sliceId).toBe(validUuid);
    expect(result.workingDirectory).toBe("/home/user/project");
    expect(result.baseBranch).toBe("main");
    expect(result.headBranch).toBe("feature/ship");
  });

  it("defaults maxFixCycles to 2", () => {
    const result = ShipRequestSchema.parse(validRequest);
    expect(result.maxFixCycles).toBe(2);
  });

  it("accepts an explicit maxFixCycles override", () => {
    const result = ShipRequestSchema.parse({ ...validRequest, maxFixCycles: 5 });
    expect(result.maxFixCycles).toBe(5);
  });

  it("rejects empty workingDirectory", () => {
    expect(() => ShipRequestSchema.parse({ ...validRequest, workingDirectory: "" })).toThrow();
  });

  it("rejects invalid sliceId", () => {
    expect(() => ShipRequestSchema.parse({ ...validRequest, sliceId: "bad-id" })).toThrow();
  });

  it("rejects negative maxFixCycles", () => {
    expect(() => ShipRequestSchema.parse({ ...validRequest, maxFixCycles: -1 })).toThrow();
  });
});

describe("ShipResultSchema", () => {
  const validResult = {
    sliceId: validUuid,
    prNumber: 7,
    prUrl: "https://github.com/org/repo/pull/7",
    fixCyclesUsed: 1,
    merged: true,
  };

  it("parses a valid result", () => {
    const result = ShipResultSchema.parse(validResult);
    expect(result.sliceId).toBe(validUuid);
    expect(result.prNumber).toBe(7);
    expect(result.merged).toBe(true);
  });

  it("accepts merged=false", () => {
    const result = ShipResultSchema.parse({ ...validResult, merged: false });
    expect(result.merged).toBe(false);
  });

  it("rejects missing sliceId", () => {
    const { sliceId: _sliceId, ...withoutSliceId } = validResult;
    expect(() => ShipResultSchema.parse(withoutSliceId)).toThrow();
  });

  it("rejects negative fixCyclesUsed", () => {
    expect(() => ShipResultSchema.parse({ ...validResult, fixCyclesUsed: -1 })).toThrow();
  });
});

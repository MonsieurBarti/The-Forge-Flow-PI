import { describe, expect, it } from "vitest";
import { computeStateHash } from "./canonical-hash";

describe("computeStateHash", () => {
  it("produces a consistent SHA-256 hex string for the same input", () => {
    const snapshot = { version: 1, project: null, milestones: [] };
    const hash1 = computeStateHash(snapshot);
    const hash2 = computeStateHash(snapshot);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash regardless of key order in objects", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(computeStateHash(a)).toBe(computeStateHash(b));
  });

  it("handles nested objects with different key orders", () => {
    const a = { outer: { z: 9, a: 1 }, list: [1, 2, 3] };
    const b = { list: [1, 2, 3], outer: { a: 1, z: 9 } };
    expect(computeStateHash(a)).toBe(computeStateHash(b));
  });

  it("handles arrays preserving element order", () => {
    const a = { items: [1, 2, 3] };
    const b = { items: [3, 2, 1] };
    expect(computeStateHash(a)).not.toBe(computeStateHash(b));
  });

  it("handles null and primitive values", () => {
    expect(computeStateHash(null)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeStateHash(42)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeStateHash("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different inputs", () => {
    const a = { version: 1 };
    const b = { version: 2 };
    expect(computeStateHash(a)).not.toBe(computeStateHash(b));
  });
});

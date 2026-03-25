import { describe, expect, it } from "vitest";
import { SyncReportSchema } from "./state-sync.schemas";

describe("SyncReportSchema", () => {
  it("accepts valid report", () => {
    const input = {
      pulled: 5,
      conflicts: ["file.ts"],
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    const result = SyncReportSchema.parse(input);
    expect(result.pulled).toBe(5);
    expect(result.conflicts).toEqual(["file.ts"]);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("coerces timestamp ISO string to Date instance", () => {
    const iso = "2024-01-15T10:30:00.000Z";
    const result = SyncReportSchema.parse({
      pulled: 0,
      conflicts: [],
      timestamp: iso,
    });
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.timestamp.toISOString()).toBe(iso);
  });

  it("rejects missing fields", () => {
    const input = {
      conflicts: ["file.ts"],
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(() => SyncReportSchema.parse(input)).toThrow();
  });

  it("rejects non-integer pulled count", () => {
    const input = {
      pulled: 3.5,
      conflicts: [],
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(() => SyncReportSchema.parse(input)).toThrow();
  });

  it("accepts empty conflicts array", () => {
    const input = {
      pulled: 0,
      conflicts: [],
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    const result = SyncReportSchema.parse(input);
    expect(result.conflicts).toEqual([]);
  });
});

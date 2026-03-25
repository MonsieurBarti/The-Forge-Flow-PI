import { describe, expect, it } from "vitest";
import {
  GitFileStatusSchema,
  GitLogEntrySchema,
  GitStatusEntrySchema,
  GitStatusSchema,
} from "./git.schemas";

describe("GitLogEntrySchema", () => {
  it("accepts a valid entry", () => {
    const result = GitLogEntrySchema.safeParse({
      hash: "abc123",
      message: "fix: resolve bug",
      author: "Alice",
      date: "2026-03-25T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when hash is missing", () => {
    const result = GitLogEntrySchema.safeParse({
      message: "fix: resolve bug",
      author: "Alice",
      date: "2026-03-25T10:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("coerces ISO string date to Date instance", () => {
    const result = GitLogEntrySchema.parse({
      hash: "abc123",
      message: "fix: resolve bug",
      author: "Alice",
      date: "2026-03-25T10:00:00Z",
    });
    expect(result.date).toBeInstanceOf(Date);
  });
});

describe("GitFileStatusSchema", () => {
  it.each([
    "added",
    "modified",
    "deleted",
    "renamed",
    "untracked",
  ] as const)("accepts valid status: %s", (status) => {
    const result = GitFileStatusSchema.safeParse(status);
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = GitFileStatusSchema.safeParse("unknown");
    expect(result.success).toBe(false);
  });
});

describe("GitStatusEntrySchema", () => {
  it("accepts a valid entry with path and status", () => {
    const result = GitStatusEntrySchema.safeParse({
      path: "src/index.ts",
      status: "modified",
    });
    expect(result.success).toBe(true);
  });
});

describe("GitStatusSchema", () => {
  it("accepts valid status with branch, clean=true, and empty entries", () => {
    const result = GitStatusSchema.safeParse({
      branch: "main",
      clean: true,
      entries: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts status with clean=false and non-empty entries", () => {
    const result = GitStatusSchema.safeParse({
      branch: "feature/test",
      clean: false,
      entries: [{ path: "src/app.ts", status: "added" }],
    });
    expect(result.success).toBe(true);
  });
});

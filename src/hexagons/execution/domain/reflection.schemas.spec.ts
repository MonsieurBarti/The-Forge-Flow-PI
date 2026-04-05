import { describe, expect, it } from "vitest";
import { ReflectionIssueSchema, ReflectionResultSchema } from "./reflection.schemas";

describe("ReflectionIssueSchema", () => {
  it("accepts blocker severity", () => {
    const result = ReflectionIssueSchema.safeParse({
      severity: "blocker",
      description: "Missing return type",
    });
    expect(result.success).toBe(true);
  });

  it("accepts warning severity", () => {
    const result = ReflectionIssueSchema.safeParse({
      severity: "warning",
      description: "Unused import",
      filePath: "src/foo.ts",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid severity", () => {
    const result = ReflectionIssueSchema.safeParse({
      severity: "info",
      description: "Something",
    });
    expect(result.success).toBe(false);
  });
});

describe("ReflectionResultSchema", () => {
  it("validates a passing fast reflection", () => {
    const result = ReflectionResultSchema.safeParse({
      passed: true,
      tier: "fast",
      issues: [],
      reflectedAt: "2026-04-05T12:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("validates a failing full reflection with issues", () => {
    const result = ReflectionResultSchema.safeParse({
      passed: false,
      tier: "full",
      issues: [{ severity: "blocker", description: "Type error in output" }],
      reflectedAt: "2026-04-05T12:00:00Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issues).toHaveLength(1);
    }
  });

  it("defaults issues to empty array when omitted", () => {
    const result = ReflectionResultSchema.safeParse({
      passed: true,
      tier: "fast",
      reflectedAt: "2026-04-05T12:00:00Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issues).toEqual([]);
    }
  });

  it("rejects invalid tier", () => {
    const result = ReflectionResultSchema.safeParse({
      passed: true,
      tier: "medium",
      reflectedAt: "2026-04-05T12:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-datetime reflectedAt", () => {
    const result = ReflectionResultSchema.safeParse({
      passed: true,
      tier: "fast",
      reflectedAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { formatDuration, renderMetadata } from "./workflow-metadata.helpers";

describe("formatDuration", () => {
  it("formats < 60 minutes as Xm", () => {
    expect(formatDuration(30 * 60_000)).toBe("30m");
  });

  it("formats >= 60m and < 24h as Xh Ym", () => {
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
  });

  it("formats >= 24h as Xd Yh", () => {
    expect(formatDuration(26 * 60 * 60_000)).toBe("1d 2h");
  });

  it("formats 0ms as 0m", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("formats exactly 60m as 1h 0m", () => {
    expect(formatDuration(60 * 60_000)).toBe("1h 0m");
  });

  it("formats exactly 24h as 1d 0h", () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe("1d 0h");
  });
});

describe("renderMetadata", () => {
  it("shows phase name and duration", () => {
    const result = renderMetadata("planning", 90 * 60_000, {
      specPath: "/path/to/spec",
      planPath: null,
      researchPath: null,
    });
    expect(result).toContain("**Phase:** planning (1h 30m)");
  });

  it("shows ✓ for existing artifacts and … for missing", () => {
    const result = renderMetadata("executing", 0, {
      specPath: "/path",
      planPath: "/path",
      researchPath: null,
    });
    expect(result).toContain("SPEC.md ✓");
    expect(result).toContain("PLAN.md ✓");
    expect(result).toContain("RESEARCH.md …");
  });

  it("shows all … when no artifacts exist", () => {
    const result = renderMetadata("discussing", 0, {
      specPath: null,
      planPath: null,
      researchPath: null,
    });
    expect(result).toContain("SPEC.md …");
    expect(result).toContain("PLAN.md …");
    expect(result).toContain("RESEARCH.md …");
  });
});

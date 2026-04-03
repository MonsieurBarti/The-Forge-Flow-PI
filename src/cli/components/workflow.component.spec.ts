import { describe, expect, it } from "vitest";
import {
  PHASE_ORDER,
  PHASE_DISPLAY_NAMES,
  renderPipeline,
  formatDuration,
  renderMetadata,
} from "./workflow.component";

describe("PHASE_ORDER", () => {
  it("contains all 8 slice statuses in order", () => {
    expect(PHASE_ORDER).toEqual([
      "discussing", "researching", "planning", "executing",
      "verifying", "reviewing", "completing", "closed",
    ]);
  });
});

describe("PHASE_DISPLAY_NAMES", () => {
  it("maps each status to a short display name", () => {
    expect(PHASE_DISPLAY_NAMES.discussing).toBe("discuss");
    expect(PHASE_DISPLAY_NAMES.completing).toBe("ship");
  });
});

describe("renderPipeline", () => {
  it("marks phases before current as completed (● marker)", () => {
    const result = renderPipeline("planning");
    expect(result).toContain("● discuss");
    expect(result).toContain("● research");
  });

  it("marks current phase with bold arrow marker", () => {
    const result = renderPipeline("planning");
    expect(result).toContain("**▶ plan**");
  });

  it("marks phases after current as future (○ marker)", () => {
    const result = renderPipeline("planning");
    expect(result).toContain("○ execute");
    expect(result).toContain("○ closed");
  });

  it("renders all 8 phases with connectors", () => {
    const result = renderPipeline("discussing");
    for (const name of Object.values(PHASE_DISPLAY_NAMES)) {
      expect(result).toContain(name);
    }
    expect(result).toContain("──");
  });

  it("handles first phase (discussing) — no completed phases", () => {
    const result = renderPipeline("discussing");
    expect(result).toContain("**▶ discuss**");
    expect(result).not.toContain("●");
  });

  it("handles last phase (closed) — all completed", () => {
    const result = renderPipeline("closed");
    expect(result).toContain("● discuss");
    expect(result).toContain("**▶ closed**");
    expect(result).not.toContain("○");
  });
});

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

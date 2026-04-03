import { describe, expect, it } from "vitest";
import {
  PHASE_ORDER,
  PHASE_DISPLAY_NAMES,
  renderPipeline,
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

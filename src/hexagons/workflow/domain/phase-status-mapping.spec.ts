import { describe, expect, it } from "vitest";
import { mapPhaseToSliceStatus } from "./phase-status-mapping";

describe("mapPhaseToSliceStatus", () => {
  it.each([
    ["discussing", "discussing"],
    ["researching", "researching"],
    ["planning", "planning"],
    ["executing", "executing"],
    ["verifying", "verifying"],
    ["reviewing", "reviewing"],
    ["shipping", "completing"],
  ] as const)("maps %s -> %s", (phase, expected) => {
    expect(mapPhaseToSliceStatus(phase)).toBe(expected);
  });

  it.each([
    ["idle"],
    ["completing-milestone"],
    ["paused"],
    ["blocked"],
  ] as const)("maps %s -> null", (phase) => {
    expect(mapPhaseToSliceStatus(phase)).toBeNull();
  });
});

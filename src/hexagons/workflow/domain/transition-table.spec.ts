import { describe, expect, it } from "vitest";
import {
  ACTIVE_PHASES,
  evaluateGuard,
  findMatchingRules,
  TRANSITION_TABLE,
} from "./transition-table";
import type { GuardContext } from "./workflow-session.schemas";

describe("TRANSITION_TABLE", () => {
  it("has exactly 19 rules", () => {
    expect(TRANSITION_TABLE).toHaveLength(19);
  });

  it("every rule has required fields", () => {
    for (const rule of TRANSITION_TABLE) {
      expect(rule.from).toBeDefined();
      expect(rule.trigger).toBeDefined();
      expect(rule.to).toBeDefined();
      expect(Array.isArray(rule.effects)).toBe(true);
    }
  });
});

describe("ACTIVE_PHASES", () => {
  it("contains the 7 active phases", () => {
    expect(ACTIVE_PHASES.size).toBe(7);
    expect(ACTIVE_PHASES.has("discussing")).toBe(true);
    expect(ACTIVE_PHASES.has("shipping")).toBe(true);
    expect(ACTIVE_PHASES.has("idle")).toBe(false);
    expect(ACTIVE_PHASES.has("paused")).toBe(false);
    expect(ACTIVE_PHASES.has("blocked")).toBe(false);
  });
});

describe("evaluateGuard", () => {
  const baseCtx: GuardContext = {
    complexityTier: "F-lite",
    retryCount: 0,
    maxRetries: 2,
    allSlicesClosed: false,
    lastError: null,
  };

  it("notSTier returns true when tier is not S", () => {
    expect(evaluateGuard("notSTier", baseCtx)).toBe(true);
  });

  it("notSTier returns false when tier is S", () => {
    expect(evaluateGuard("notSTier", { ...baseCtx, complexityTier: "S" })).toBe(false);
  });

  it("isSTier returns true when tier is S", () => {
    expect(evaluateGuard("isSTier", { ...baseCtx, complexityTier: "S" })).toBe(true);
  });

  it("isSTier returns false when tier is not S", () => {
    expect(evaluateGuard("isSTier", baseCtx)).toBe(false);
  });

  it("allSlicesClosed returns true when all closed", () => {
    expect(evaluateGuard("allSlicesClosed", { ...baseCtx, allSlicesClosed: true })).toBe(true);
  });

  it("allSlicesClosed returns false when not all closed", () => {
    expect(evaluateGuard("allSlicesClosed", baseCtx)).toBe(false);
  });

  it("retriesExhausted returns true when retryCount >= maxRetries", () => {
    expect(evaluateGuard("retriesExhausted", { ...baseCtx, retryCount: 2, maxRetries: 2 })).toBe(
      true,
    );
    expect(evaluateGuard("retriesExhausted", { ...baseCtx, retryCount: 3, maxRetries: 2 })).toBe(
      true,
    );
  });

  it("retriesExhausted returns false when retryCount < maxRetries", () => {
    expect(evaluateGuard("retriesExhausted", { ...baseCtx, retryCount: 1, maxRetries: 2 })).toBe(
      false,
    );
  });
});

describe("findMatchingRules", () => {
  it("finds exact-match rules", () => {
    const rules = findMatchingRules("idle", "start");
    expect(rules.length).toBe(1);
    expect(rules[0].to).toBe("discussing");
  });

  it("finds wildcard *active* rules for active phases", () => {
    const rules = findMatchingRules("executing", "pause");
    expect(rules.some((r) => r.to === "paused")).toBe(true);
  });

  it("does not match *active* rules for non-active phases", () => {
    const rules = findMatchingRules("paused", "pause");
    expect(rules).toHaveLength(0);
  });

  it("returns guarded rules for discussing+next", () => {
    const rules = findMatchingRules("discussing", "next");
    expect(rules).toHaveLength(2);
    expect(rules[0].guard).toBe("notSTier");
    expect(rules[1].guard).toBe("isSTier");
  });
});

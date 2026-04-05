import { describe, expect, it } from "vitest";
import { DefaultRetryPolicy } from "./default-retry-policy";

describe("DefaultRetryPolicy", () => {
  describe("shouldRetry", () => {
    it("allows retry when under max retries", () => {
      const policy = new DefaultRetryPolicy(2, 3);
      const decision = policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 0);
      expect(decision.retry).toBe(true);
    });

    it("rejects retry when max retries reached", () => {
      const policy = new DefaultRetryPolicy(2, 3);
      const decision = policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 2);
      expect(decision.retry).toBe(false);
      expect(decision.reason).toContain("max retries");
    });

    it("detects retry loop via identical error signatures", () => {
      const policy = new DefaultRetryPolicy(5, 3);

      policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
      policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
      policy.recordFailure("task-1", "OVERSEER.TIMEOUT");

      const decision = policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 1);
      expect(decision.retry).toBe(false);
      expect(decision.reason).toContain("identical errors");
    });

    it("allows retry when errors are different", () => {
      const policy = new DefaultRetryPolicy(5, 3);

      policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
      policy.recordFailure("task-1", "AGENT_DISPATCH.UNEXPECTED_FAILURE");
      policy.recordFailure("task-1", "OVERSEER.TIMEOUT");

      const decision = policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 1);
      expect(decision.retry).toBe(true);
    });
  });

  describe("recordFailure / reset", () => {
    it("reset clears failure history", () => {
      const policy = new DefaultRetryPolicy(5, 3);

      policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
      policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
      policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
      policy.reset("task-1");

      const decision = policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 0);
      expect(decision.retry).toBe(true);
    });

    it("tracks failures per task independently", () => {
      const policy = new DefaultRetryPolicy(5, 3);

      policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
      policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
      policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
      policy.recordFailure("task-2", "OVERSEER.TIMEOUT");

      expect(policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 1).retry).toBe(false);
      expect(policy.shouldRetry("task-2", "OVERSEER.TIMEOUT", 0).retry).toBe(true);
    });
  });

  describe("resolveModel", () => {
    const id = "task-1";

    it("retries on same profile at attempt 0", () => {
      const policy = new DefaultRetryPolicy(3, 3);
      const result = policy.resolveModel(id, "quality", 0);
      expect(result).toEqual({ action: "retry", profile: "quality", attempt: 0 });
    });

    it("retries on same profile at attempt 1 (retryCountPerProfile default)", () => {
      const policy = new DefaultRetryPolicy(3, 3);
      const result = policy.resolveModel(id, "quality", 1);
      expect(result).toEqual({ action: "retry", profile: "quality", attempt: 1 });
    });

    it("downshifts from quality to balanced at attempt 2", () => {
      const policy = new DefaultRetryPolicy(3, 3);
      const result = policy.resolveModel(id, "quality", 2);
      expect(result).toEqual({ action: "downshift", profile: "balanced", attempt: 0 });
    });

    it("downshifts from balanced to budget at attempt 2", () => {
      const policy = new DefaultRetryPolicy(3, 3);
      const result = policy.resolveModel(id, "balanced", 2);
      expect(result).toEqual({ action: "downshift", profile: "budget", attempt: 0 });
    });

    it("escalates when budget exceeds retryCountPerProfile", () => {
      const policy = new DefaultRetryPolicy(3, 3);
      const result = policy.resolveModel(id, "budget", 2);
      expect(result).toEqual({ action: "escalate", profile: "budget", attempt: 2 });
    });

    it("walks the full downshift chain with retryCountPerProfile=1", () => {
      const policy = new DefaultRetryPolicy(3, 3);

      // quality: attempt 0 → retry
      expect(policy.resolveModel(id, "quality", 0)).toEqual({
        action: "retry",
        profile: "quality",
        attempt: 0,
      });
      // quality: attempt 1 → retry (still within retryCountPerProfile)
      expect(policy.resolveModel(id, "quality", 1)).toEqual({
        action: "retry",
        profile: "quality",
        attempt: 1,
      });
      // quality: attempt 2 → downshift to balanced
      expect(policy.resolveModel(id, "quality", 2)).toEqual({
        action: "downshift",
        profile: "balanced",
        attempt: 0,
      });
      // balanced: attempt 0 → retry
      expect(policy.resolveModel(id, "balanced", 0)).toEqual({
        action: "retry",
        profile: "balanced",
        attempt: 0,
      });
      // balanced: attempt 1 → retry
      expect(policy.resolveModel(id, "balanced", 1)).toEqual({
        action: "retry",
        profile: "balanced",
        attempt: 1,
      });
      // balanced: attempt 2 → downshift to budget
      expect(policy.resolveModel(id, "balanced", 2)).toEqual({
        action: "downshift",
        profile: "budget",
        attempt: 0,
      });
      // budget: attempt 0 → retry
      expect(policy.resolveModel(id, "budget", 0)).toEqual({
        action: "retry",
        profile: "budget",
        attempt: 0,
      });
      // budget: attempt 1 → retry
      expect(policy.resolveModel(id, "budget", 1)).toEqual({
        action: "retry",
        profile: "budget",
        attempt: 1,
      });
      // budget: attempt 2 → escalate
      expect(policy.resolveModel(id, "budget", 2)).toEqual({
        action: "escalate",
        profile: "budget",
        attempt: 2,
      });
    });

    it("escalates immediately when profile is not in chain", () => {
      const policy = new DefaultRetryPolicy(3, 3);
      const result = policy.resolveModel(id, "unknown-profile", 2);
      expect(result).toEqual({ action: "escalate", profile: "unknown-profile", attempt: 2 });
    });

    it("respects custom retryCountPerProfile", () => {
      const policy = new DefaultRetryPolicy(5, 3, ["quality", "balanced", "budget"], 2);

      // attempt 0, 1, 2 → retry on quality
      expect(policy.resolveModel(id, "quality", 0).action).toBe("retry");
      expect(policy.resolveModel(id, "quality", 1).action).toBe("retry");
      expect(policy.resolveModel(id, "quality", 2).action).toBe("retry");
      // attempt 3 → downshift
      expect(policy.resolveModel(id, "quality", 3)).toEqual({
        action: "downshift",
        profile: "balanced",
        attempt: 0,
      });
    });

    it("respects custom downshift chain", () => {
      const policy = new DefaultRetryPolicy(3, 3, ["fast", "slow"], 1);

      expect(policy.resolveModel(id, "fast", 2)).toEqual({
        action: "downshift",
        profile: "slow",
        attempt: 0,
      });
      expect(policy.resolveModel(id, "slow", 2)).toEqual({
        action: "escalate",
        profile: "slow",
        attempt: 2,
      });
    });
  });
});

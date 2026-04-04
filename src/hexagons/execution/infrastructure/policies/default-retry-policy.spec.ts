import { describe, expect, it } from "vitest";
import { DefaultRetryPolicy } from "./default-retry-policy";

describe("DefaultRetryPolicy", () => {
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

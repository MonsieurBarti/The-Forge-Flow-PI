import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverseerConfig, OverseerContext } from "../domain/overseer.schemas";
import { TimeoutStrategy } from "./timeout-strategy";

const OVERSEER_CONFIG: OverseerConfig = {
  enabled: true,
  timeouts: { S: 100, "F-lite": 200, "F-full": 300 },
  retryLoop: { threshold: 3 },
};

function makeContext(tier: "S" | "F-lite" | "F-full" = "S"): OverseerContext {
  return {
    taskId: crypto.randomUUID(),
    sliceId: crypto.randomUUID(),
    complexityTier: tier,
    dispatchTimestamp: new Date(),
  };
}

describe("TimeoutStrategy", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with verdict after tier timeout", async () => {
    const strategy = new TimeoutStrategy(OVERSEER_CONFIG);
    const ctx = makeContext("S");
    const promise = strategy.start(ctx);

    vi.advanceTimersByTime(100);

    const verdict = await promise;
    expect(verdict.strategy).toBe("timeout");
    expect(verdict.reason).toContain("100");
  });

  it("uses F-full timeout for F-full tier", async () => {
    const strategy = new TimeoutStrategy(OVERSEER_CONFIG);
    const ctx = makeContext("F-full");
    const promise = strategy.start(ctx);

    vi.advanceTimersByTime(300);
    const verdict = await promise;
    expect(verdict.strategy).toBe("timeout");
    expect(verdict.reason).toContain("300");
  });

  it("cancel prevents resolution", async () => {
    const strategy = new TimeoutStrategy(OVERSEER_CONFIG);
    const ctx = makeContext("S");
    const promise = strategy.start(ctx);

    strategy.cancel(ctx.taskId);
    vi.advanceTimersByTime(200);

    await expect(promise).rejects.toThrow("cancelled");
  });

  it("id is 'timeout'", () => {
    const strategy = new TimeoutStrategy(OVERSEER_CONFIG);
    expect(strategy.id).toBe("timeout");
  });
});

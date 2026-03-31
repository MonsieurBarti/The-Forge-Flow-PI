import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverseerContext, OverseerVerdict } from "../domain/overseer.schemas";
import type { OverseerStrategy } from "../domain/overseer-strategy";
import { ComposableOverseerAdapter } from "./composable-overseer.adapter";

function makeContext(taskId?: string): OverseerContext {
  return {
    taskId: taskId ?? crypto.randomUUID(),
    sliceId: crypto.randomUUID(),
    complexityTier: "S",
    dispatchTimestamp: new Date(),
  };
}

function fakeStrategy(id: string, delayMs: number): OverseerStrategy {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const rejectors = new Map<string, (e: Error) => void>();
  return {
    id,
    start(ctx: OverseerContext): Promise<OverseerVerdict> {
      return new Promise((resolve, reject) => {
        rejectors.set(ctx.taskId, reject);
        const t = setTimeout(() => {
          timers.delete(ctx.taskId);
          rejectors.delete(ctx.taskId);
          resolve({ strategy: id, reason: `${id} triggered` });
        }, delayMs);
        timers.set(ctx.taskId, t);
      });
    },
    cancel(taskId: string) {
      const t = timers.get(taskId);
      if (t) clearTimeout(t);
      timers.delete(taskId);
      const r = rejectors.get(taskId);
      if (r) r(new Error("cancelled"));
      rejectors.delete(taskId);
    },
  };
}

describe("ComposableOverseerAdapter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with first triggered strategy (race)", async () => {
    const fast = fakeStrategy("fast", 50);
    const slow = fakeStrategy("slow", 200);
    const adapter = new ComposableOverseerAdapter([fast, slow]);
    const ctx = makeContext();

    const promise = adapter.monitor(ctx);
    vi.advanceTimersByTime(50);
    const verdict = await promise;

    expect(verdict.strategy).toBe("fast");
  });

  it("stop cancels monitors for specific task only", async () => {
    const strategy = fakeStrategy("timeout", 100);
    const adapter = new ComposableOverseerAdapter([strategy]);
    const ctx1 = makeContext("task-1");
    const ctx2 = makeContext("task-2");

    const p1 = adapter.monitor(ctx1);
    adapter.monitor(ctx2);

    await adapter.stop("task-1");
    await expect(p1).rejects.toThrow("cancelled");
  });

  it("stopAll cancels all active monitors", async () => {
    const strategy = fakeStrategy("timeout", 100);
    const adapter = new ComposableOverseerAdapter([strategy]);

    const p1 = adapter.monitor(makeContext("task-1"));
    const p2 = adapter.monitor(makeContext("task-2"));

    await adapter.stopAll();

    await expect(p1).rejects.toThrow("cancelled");
    await expect(p2).rejects.toThrow("cancelled");
  });
});

import { isOk } from "@kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoBudgetTrackingAdapter } from "./no-budget-tracking.adapter";

describe("NoBudgetTrackingAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok(0)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new NoBudgetTrackingAdapter();
    const result = await adapter.getUsagePercent();
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.data).toBe(0);
  });

  it("warns on first call", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new NoBudgetTrackingAdapter();
    await adapter.getUsagePercent();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      "[tff] Budget tracking not configured — model selection uses defaults",
    );
  });

  it("warns only once across multiple calls", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new NoBudgetTrackingAdapter();
    await adapter.getUsagePercent();
    await adapter.getUsagePercent();
    await adapter.getUsagePercent();
    expect(spy).toHaveBeenCalledOnce();
  });
});

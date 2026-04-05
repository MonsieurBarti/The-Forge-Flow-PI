import { describe, expect, it, vi } from "vitest";
import { LoggingBudgetAdapter } from "./logging-budget.adapter";

describe("LoggingBudgetAdapter", () => {
  const makeLogger = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });

  it("returns ok(0)", async () => {
    const adapter = new LoggingBudgetAdapter(makeLogger());
    const result = await adapter.getUsagePercent();
    expect(result).toEqual({ ok: true, data: 0 });
  });

  it("logs warning on first call", async () => {
    const logger = makeLogger();
    const adapter = new LoggingBudgetAdapter(logger);
    await adapter.getUsagePercent();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      "Budget tracking not configured — using unlimited budget",
    );
  });

  it("logs warning only once across multiple calls", async () => {
    const logger = makeLogger();
    const adapter = new LoggingBudgetAdapter(logger);
    await adapter.getUsagePercent();
    await adapter.getUsagePercent();
    await adapter.getUsagePercent();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

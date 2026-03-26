import { describe, expect, it, vi } from "vitest";
import { ConsoleLoggerAdapter } from "./console-logger.adapter";

describe("ConsoleLoggerAdapter", () => {
  it("delegates to console methods without throwing", () => {
    const logger = new ConsoleLoggerAdapter();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("test", { key: "value" });
    expect(spy).toHaveBeenCalledWith("test", { key: "value" });
    spy.mockRestore();
  });

  it("omits context argument when not provided", () => {
    const logger = new ConsoleLoggerAdapter();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("test");
    expect(spy).toHaveBeenCalledWith("test");
    spy.mockRestore();
  });
});

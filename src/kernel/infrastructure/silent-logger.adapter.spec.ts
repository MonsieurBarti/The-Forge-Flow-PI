import { describe, expect, it } from "vitest";
import { SilentLoggerAdapter } from "./silent-logger.adapter";

describe("SilentLoggerAdapter", () => {
  it("implements all LoggerPort methods without throwing", () => {
    const logger = new SilentLoggerAdapter();
    expect(() => {
      logger.error("err");
      logger.warn("warn");
      logger.info("info");
      logger.debug("debug");
    }).not.toThrow();
  });

  it("captures messages for test assertions", () => {
    const logger = new SilentLoggerAdapter();
    logger.error("boom", { key: "value" });
    logger.warn("careful");

    const messages = logger.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      level: "error",
      message: "boom",
      context: { key: "value" },
    });
    expect(messages[1]).toEqual({
      level: "warn",
      message: "careful",
      context: undefined,
    });
  });

  it("reset clears captured messages", () => {
    const logger = new SilentLoggerAdapter();
    logger.info("something");
    logger.reset();
    expect(logger.getMessages()).toHaveLength(0);
  });
});

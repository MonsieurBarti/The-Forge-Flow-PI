import { describe, expect, it } from "vitest";
import { SystemDateProvider } from "./system-date-provider.adapter";

describe("SystemDateProvider", () => {
  it("returns a Date instance", () => {
    const provider = new SystemDateProvider();
    const result = provider.now();
    expect(result).toBeInstanceOf(Date);
  });

  it("returns a date close to the current time", () => {
    const provider = new SystemDateProvider();
    const before = Date.now();
    const result = provider.now();
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });
});

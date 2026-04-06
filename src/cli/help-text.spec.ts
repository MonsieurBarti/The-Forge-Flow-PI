import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { printHelp } from "./help-text";

describe("printHelp", () => {
  let writeSpy: MockInstance;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("writes usage text containing the version", () => {
    printHelp("1.2.3");

    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("1.2.3");
  });

  it("includes --version and --help flags", () => {
    printHelp("0.1.0");

    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("--version");
    expect(output).toContain("--help");
  });

  it("includes --model and --print flags", () => {
    printHelp("0.1.0");

    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("--model");
    expect(output).toContain("--print");
  });

  it("includes the documentation URL", () => {
    printHelp("0.1.0");

    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("https://github.com/MonsieurBarti/The-Forge-Flow-PI");
  });
});

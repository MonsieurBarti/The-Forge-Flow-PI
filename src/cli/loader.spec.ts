import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkNodeVersion, getVersion } from "./loader-utils";

describe("getVersion", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tff-loader-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads version from package.json", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "1.2.3" }));

    expect(getVersion(tempDir)).toBe("1.2.3");
  });

  it("returns 0.0.0 when package.json is missing", () => {
    expect(getVersion(join(tempDir, "nonexistent"))).toBe("0.0.0");
  });

  it("returns 0.0.0 when version field is missing", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "test" }));

    expect(getVersion(tempDir)).toBe("0.0.0");
  });

  it("returns 0.0.0 when package.json is invalid JSON", () => {
    writeFileSync(join(tempDir, "package.json"), "not json");

    expect(getVersion(tempDir)).toBe("0.0.0");
  });
});

describe("checkNodeVersion", () => {
  it("does not exit when node version meets minimum", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    checkNodeVersion(22);

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("exits with error when node version is below minimum", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    checkNodeVersion(999);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("Node.js >= 999");
    expect(output).toContain("nvm install");

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

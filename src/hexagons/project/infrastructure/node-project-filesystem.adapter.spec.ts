import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isOk } from "@kernel";
import { NodeProjectFileSystemAdapter } from "./node-project-filesystem.adapter";

describe("NodeProjectFileSystemAdapter", () => {
  let tempDir: string;
  let adapter: NodeProjectFileSystemAdapter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tff-test-"));
    adapter = new NodeProjectFileSystemAdapter();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("exists returns false for non-existent path", async () => {
    const result = await adapter.exists(join(tempDir, "nope"));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(false);
  });

  it("createDirectory + exists roundtrip", async () => {
    const dir = join(tempDir, "a", "b", "c");
    await adapter.createDirectory(dir, { recursive: true });
    const result = await adapter.exists(dir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(true);
  });

  it("writeFile + exists roundtrip", async () => {
    const filePath = join(tempDir, "test.txt");
    await adapter.writeFile(filePath, "hello");
    const result = await adapter.exists(filePath);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(true);
  });
});

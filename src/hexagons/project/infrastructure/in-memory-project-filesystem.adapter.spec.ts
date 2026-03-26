import { describe, expect, it } from "vitest";
import { isOk } from "@kernel";
import { InMemoryProjectFileSystemAdapter } from "./in-memory-project-filesystem.adapter";

describe("InMemoryProjectFileSystemAdapter", () => {
  it("exists returns false for non-existent path", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    const result = await adapter.exists("/project/.tff");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(false);
  });

  it("createDirectory + exists roundtrip", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    await adapter.createDirectory("/project/.tff/milestones", { recursive: true });
    const result = await adapter.exists("/project/.tff/milestones");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(true);
  });

  it("writeFile + exists roundtrip", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    await adapter.writeFile("/project/.tff/PROJECT.md", "# My Project");
    const result = await adapter.exists("/project/.tff/PROJECT.md");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(true);
  });

  it("writeFile stores content retrievable via getContent", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    await adapter.writeFile("/project/.tff/settings.yaml", "key: value");
    expect(adapter.getContent("/project/.tff/settings.yaml")).toBe("key: value");
  });

  it("reset clears all entries", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    await adapter.writeFile("/project/.tff/PROJECT.md", "# My Project");
    adapter.reset();
    const result = await adapter.exists("/project/.tff/PROJECT.md");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(false);
  });

  it("recursive createDirectory creates parent paths", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    await adapter.createDirectory("/a/b/c/d", { recursive: true });
    for (const path of ["/a", "/a/b", "/a/b/c", "/a/b/c/d"]) {
      const result = await adapter.exists(path);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe(true);
    }
  });
});

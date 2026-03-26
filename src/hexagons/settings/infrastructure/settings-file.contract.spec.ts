import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOk } from "@kernel";
import { afterAll, describe, expect, it } from "vitest";
import type { SettingsFilePort } from "../domain/ports/settings-file.port";
import { FsSettingsFileAdapter } from "./fs-settings-file.adapter";
import { InMemorySettingsFileAdapter } from "./in-memory-settings-file.adapter";

function runContractTests(
  name: string,
  factory: () => {
    port: SettingsFilePort;
    seed: (content: string) => Promise<string>;
    nonExistentPath: () => string;
    cleanup: () => Promise<void>;
  },
) {
  describe(name, () => {
    it("returns file content for existing file", async () => {
      const { port, seed, cleanup } = factory();
      const path = await seed("model-profiles:\n  quality:\n    model: opus");
      try {
        const result = await port.readFile(path);
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data).toBe("model-profiles:\n  quality:\n    model: opus");
        }
      } finally {
        await cleanup();
      }
    });

    it("returns ok(null) for non-existent file", async () => {
      const { port, nonExistentPath, cleanup } = factory();
      try {
        const result = await port.readFile(nonExistentPath());
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data).toBeNull();
        }
      } finally {
        await cleanup();
      }
    });
  });
}

// --- InMemory adapter ---
runContractTests("InMemorySettingsFileAdapter", () => {
  const adapter = new InMemorySettingsFileAdapter();
  let seededPath = "";
  return {
    port: adapter,
    seed: async (content: string): Promise<string> => {
      seededPath = `/test/settings-${Date.now()}.yaml`;
      adapter.seed(seededPath, content);
      return seededPath;
    },
    nonExistentPath: () => "/nonexistent/path/settings.yaml",
    cleanup: async () => {
      adapter.reset();
    },
  };
});

// --- Fs adapter ---
const testDir = join(tmpdir(), `tff-settings-test-${Date.now()}`);

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

runContractTests("FsSettingsFileAdapter", () => {
  const adapter = new FsSettingsFileAdapter();
  let fullPath = "";
  return {
    port: adapter,
    seed: async (content: string): Promise<string> => {
      await mkdir(testDir, { recursive: true });
      fullPath = join(testDir, `settings-${Date.now()}.yaml`);
      await writeFile(fullPath, content, "utf-8");
      return fullPath;
    },
    nonExistentPath: () => join(testDir, "does-not-exist.yaml"),
    cleanup: async () => {
      // individual test cleanup is a no-op; afterAll handles the dir
    },
  };
});

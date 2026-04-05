import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import type { ArtifactFilePort } from "../domain/ports/artifact-file.port";
import { InMemoryArtifactFileAdapter } from "./in-memory-artifact-file.adapter";
import { NodeArtifactFileAdapter } from "./node-artifact-file.adapter";

// Shared contract — parameterized test suite
function artifactFileContractTests(
  name: string,
  factory: () => { adapter: ArtifactFilePort; cleanup?: () => Promise<void> },
) {
  describe(`ArtifactFilePort contract: ${name}`, () => {
    it("should write and read back content", async () => {
      const { adapter, cleanup } = factory();
      const writeResult = await adapter.write("M03", "M03-S05", "spec", "# My Spec");
      expect(isOk(writeResult)).toBe(true);

      const readResult = await adapter.read("M03", "M03-S05", "spec");
      expect(isOk(readResult)).toBe(true);
      if (isOk(readResult)) expect(readResult.data).toBe("# My Spec");

      await cleanup?.();
    });

    it("should return null for missing artifact", async () => {
      const { adapter, cleanup } = factory();
      const result = await adapter.read("M03", "M03-S99", "spec");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBeNull();

      await cleanup?.();
    });

    it("should overwrite existing artifact", async () => {
      const { adapter, cleanup } = factory();
      await adapter.write("M03", "M03-S05", "spec", "v1");
      await adapter.write("M03", "M03-S05", "spec", "v2");
      const result = await adapter.read("M03", "M03-S05", "spec");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe("v2");

      await cleanup?.();
    });

    it("should handle all artifact types", async () => {
      const { adapter, cleanup } = factory();
      for (const type of ["spec", "plan", "research", "checkpoint"] as const) {
        const writeResult = await adapter.write("M01", "M01-S01", type, `content-${type}`);
        expect(isOk(writeResult)).toBe(true);
      }

      await cleanup?.();
    });
  });
}

// Run contract tests for InMemoryArtifactFileAdapter
artifactFileContractTests("InMemoryArtifactFileAdapter", () => ({
  adapter: new InMemoryArtifactFileAdapter(),
}));

// Run contract tests for NodeArtifactFileAdapter
artifactFileContractTests("NodeArtifactFileAdapter", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "tff-test-"));

  return {
    adapter: new NodeArtifactFileAdapter(projectRoot),
    cleanup: async () => {
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
});

// Kind-aware path resolution tests for NodeArtifactFileAdapter
describe("NodeArtifactFileAdapter kind-aware paths", () => {
  it("resolves milestone artifact path", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "tff-test-"));
    const adapter = new NodeArtifactFileAdapter(projectRoot);

    const result = await adapter.write("M07", "M07-S01", "spec", "content", "milestone");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toBe(
        join(projectRoot, ".tff", "milestones", "M07", "slices", "M07-S01", "SPEC.md"),
      );
    }

    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("resolves quick artifact path", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "tff-test-"));
    const adapter = new NodeArtifactFileAdapter(projectRoot);

    const result = await adapter.write(null, "Q-01", "spec", "content", "quick");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toBe(join(projectRoot, ".tff", "quick", "Q-01", "SPEC.md"));
    }

    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("resolves debug artifact path", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "tff-test-"));
    const adapter = new NodeArtifactFileAdapter(projectRoot);

    const result = await adapter.write(null, "D-01", "plan", "content", "debug");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toBe(join(projectRoot, ".tff", "debug", "D-01", "PLAN.md"));
    }

    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("defaults to milestone when kind omitted", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "tff-test-"));
    const adapter = new NodeArtifactFileAdapter(projectRoot);

    const result = await adapter.write("M07", "M07-S01", "spec", "content");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toBe(
        join(projectRoot, ".tff", "milestones", "M07", "slices", "M07-S01", "SPEC.md"),
      );
    }

    rmSync(projectRoot, { recursive: true, force: true });
  });
});

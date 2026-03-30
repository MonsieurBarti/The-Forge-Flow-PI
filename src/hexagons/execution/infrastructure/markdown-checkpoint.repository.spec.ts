import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isErr, isOk, ok, type PersistenceError, type Result } from "@kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckpointBuilder } from "../domain/checkpoint.builder";
import { runContractTests } from "./checkpoint-repository.contract.spec";
import { MarkdownCheckpointRepository } from "./markdown-checkpoint.repository";

let basePath: string;

beforeAll(async () => {
  basePath = await mkdtemp(join(tmpdir(), "tff-checkpoint-"));
});

afterAll(async () => {
  await rm(basePath, { recursive: true, force: true });
});

function createResolver(
  base: string,
): (sliceId: string) => Promise<Result<string, PersistenceError>> {
  return async (sliceId: string) => {
    const relativePath = `slices/${sliceId}`;
    await mkdir(join(base, relativePath), { recursive: true });
    return ok(relativePath);
  };
}

runContractTests("MarkdownCheckpointRepository", () => {
  const repo = new MarkdownCheckpointRepository(basePath, createResolver(basePath));
  return repo;
});

describe("MarkdownCheckpointRepository -- adapter-specific", () => {
  it("returns PersistenceError for corrupt CHECKPOINT.md (missing JSON)", async () => {
    const resolver = createResolver(basePath);
    const repo = new MarkdownCheckpointRepository(basePath, resolver);
    const sliceId = crypto.randomUUID();

    const pathResult = await resolver(sliceId);
    if (!pathResult.ok) throw new Error("resolver failed");
    const filePath = join(basePath, pathResult.data, "CHECKPOINT.md");
    await writeFile(filePath, "# Corrupt file\n\nNo JSON here.", "utf-8");

    const result = await repo.findBySliceId(sliceId);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("Corrupt CHECKPOINT.md");
    }
  });

  it("returns PersistenceError for corrupt CHECKPOINT.md (invalid JSON)", async () => {
    const resolver = createResolver(basePath);
    const repo = new MarkdownCheckpointRepository(basePath, resolver);
    const sliceId = crypto.randomUUID();

    const pathResult = await resolver(sliceId);
    if (!pathResult.ok) throw new Error("resolver failed");
    const filePath = join(basePath, pathResult.data, "CHECKPOINT.md");
    await writeFile(filePath, "# Corrupt\n\n<!-- CHECKPOINT_JSON\n{invalid json\n-->", "utf-8");

    const result = await repo.findBySliceId(sliceId);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain("invalid JSON");
    }
  });

  it("JSON in HTML comment recoverable via single JSON.parse (AC9)", async () => {
    const resolver = createResolver(basePath);
    const repo = new MarkdownCheckpointRepository(basePath, resolver);
    const cp = new CheckpointBuilder().build();
    const taskId = crypto.randomUUID();
    cp.recordTaskStart(taskId, "opus", new Date());
    await repo.save(cp);

    const findResult = await repo.findBySliceId(cp.sliceId);
    expect(isOk(findResult)).toBe(true);
    if (isOk(findResult)) {
      const found = findResult.data;
      expect(found).not.toBeNull();
      if (found) {
        expect(found.id).toBe(cp.id);
        expect(found.executorLog[0].taskId).toBe(taskId);
      }
    }
  });
});

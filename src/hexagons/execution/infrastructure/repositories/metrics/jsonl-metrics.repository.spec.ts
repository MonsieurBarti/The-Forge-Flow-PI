import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOk } from "@kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskMetricsBuilder } from "../../../domain/task-metrics.builder";
import { JsonlMetricsRepository } from "./jsonl-metrics.repository";
import { runMetricsContractTests } from "./metrics-repository.contract.spec";

let basePath: string;

beforeAll(async () => {
  basePath = await mkdtemp(join(tmpdir(), "tff-metrics-"));
});
afterAll(async () => {
  await rm(basePath, { recursive: true, force: true });
});

runMetricsContractTests(
  "JsonlMetricsRepository",
  () => new JsonlMetricsRepository(join(basePath, `test-${crypto.randomUUID()}.jsonl`)),
);

describe("JsonlMetricsRepository (JSONL-specific)", () => {
  it("appends one JSON line per entry", async () => {
    const testFile = join(basePath, `lines-${crypto.randomUUID()}.jsonl`);
    const repo = new JsonlMetricsRepository(testFile);
    await repo.append(new TaskMetricsBuilder().build());
    await repo.append(new TaskMetricsBuilder().build());

    const content = await readFile(testFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[0])).not.toThrow();
    expect(() => JSON.parse(lines[1])).not.toThrow();
  });

  it("skips corrupt lines and returns valid entries", async () => {
    const testFile = join(basePath, `corrupt-${crypto.randomUUID()}.jsonl`);
    const repo = new JsonlMetricsRepository(testFile);
    const validEntry = new TaskMetricsBuilder().build();
    await repo.append(validEntry);
    await appendFile(testFile, "not valid json\n", "utf-8");
    await repo.append(new TaskMetricsBuilder().build());

    const result = await repo.readAll();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(2);
    }
  });

  it("returns empty array for non-existent file", async () => {
    const repo = new JsonlMetricsRepository(join(basePath, "nonexistent.jsonl"));
    const result = await repo.readAll();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toHaveLength(0);
  });

  it("backward compat: entries without type field parse as task-metrics", async () => {
    const testFile = join(basePath, `backcompat-${crypto.randomUUID()}.jsonl`);
    const entry = new TaskMetricsBuilder().build();
    // Write a line without the type field (simulating old data)
    const { type: _, ...entryWithoutType } = entry;
    const line = JSON.stringify({
      ...entryWithoutType,
      timestamp:
        entryWithoutType.timestamp instanceof Date
          ? entryWithoutType.timestamp.toISOString()
          : entryWithoutType.timestamp,
    });
    await appendFile(testFile, `${line}\n`, "utf-8");

    const repo = new JsonlMetricsRepository(testFile);
    const result = await repo.readAll();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe("task-metrics");
    }

    // Also verify readBySlice picks it up
    const sliceResult = await repo.readBySlice(entry.sliceId);
    expect(isOk(sliceResult)).toBe(true);
    if (isOk(sliceResult)) {
      expect(sliceResult.data).toHaveLength(1);
    }
  });
});

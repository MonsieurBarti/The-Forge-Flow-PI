import { err, isErr, isOk, ok, type Result } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import { ExecutorQueryError } from "../../../domain/errors/executor-query.error";
import { CachedExecutorQueryAdapter } from "./cached-executor-query.adapter";

describe("CachedExecutorQueryAdapter", () => {
  function createSpy(responses: Map<string, ReadonlySet<string>>) {
    return vi.fn(
      async (sliceId: string): Promise<Result<ReadonlySet<string>, ExecutorQueryError>> => {
        return ok(responses.get(sliceId) ?? new Set());
      },
    );
  }

  it("delegates to underlying query on first call (AC6)", async () => {
    const responses = new Map([["s1", new Set(["agent-a"])]]);
    const spy = createSpy(responses);
    const adapter = new CachedExecutorQueryAdapter(spy);

    const result = await adapter.getSliceExecutors("s1");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toEqual(new Set(["agent-a"]));
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns cached result on second call for same sliceId (AC6)", async () => {
    const responses = new Map([["s1", new Set(["agent-a"])]]);
    const spy = createSpy(responses);
    const adapter = new CachedExecutorQueryAdapter(spy);

    await adapter.getSliceExecutors("s1");
    await adapter.getSliceExecutors("s1");

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("queries again for different sliceId — per-key cache (AC7)", async () => {
    const responses = new Map([
      ["s1", new Set(["agent-a"])],
      ["s2", new Set(["agent-b"])],
    ]);
    const spy = createSpy(responses);
    const adapter = new CachedExecutorQueryAdapter(spy);

    await adapter.getSliceExecutors("s1");
    const result = await adapter.getSliceExecutors("s2");

    expect(spy).toHaveBeenCalledTimes(2);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toEqual(new Set(["agent-b"]));
    }
  });

  it("does not cache error results — retries on next call", async () => {
    let callCount = 0;
    const queryFn = vi.fn(async (): Promise<Result<ReadonlySet<string>, ExecutorQueryError>> => {
      callCount++;
      if (callCount === 1) return err(new ExecutorQueryError("transient"));
      return ok(new Set(["agent-a"]));
    });
    const adapter = new CachedExecutorQueryAdapter(queryFn);

    const r1 = await adapter.getSliceExecutors("s1");
    expect(isErr(r1)).toBe(true);

    const r2 = await adapter.getSliceExecutors("s1");
    expect(isOk(r2)).toBe(true);
    expect(queryFn).toHaveBeenCalledTimes(2);
  });
});

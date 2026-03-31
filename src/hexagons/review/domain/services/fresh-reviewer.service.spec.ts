import { err, isErr, isOk, ok } from "@kernel";
import { describe, expect, it } from "vitest";
import { ExecutorQueryError } from "../errors/executor-query.error";
import { FreshReviewerViolationError } from "../errors/fresh-reviewer-violation.error";
import { ExecutorQueryPort } from "../ports/executor-query.port";
import { FreshReviewerService } from "./fresh-reviewer.service";

class StubExecutorQueryPort extends ExecutorQueryPort {
  constructor(
    private readonly result: Awaited<ReturnType<ExecutorQueryPort["getSliceExecutors"]>>,
  ) {
    super();
  }
  async getSliceExecutors() {
    return this.result;
  }
}

describe("FreshReviewerService", () => {
  const sliceId = "slice-1";

  it("returns error when candidate is in executor set (AC1)", async () => {
    const port = new StubExecutorQueryPort(ok(new Set(["agent-a", "agent-b"])));
    const service = new FreshReviewerService(port);

    const result = await service.enforce(sliceId, "agent-a");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FreshReviewerViolationError);
    }
  });

  it("returns ok when candidate is not in executor set (AC2)", async () => {
    const port = new StubExecutorQueryPort(ok(new Set(["agent-a", "agent-b"])));
    const service = new FreshReviewerService(port);

    const result = await service.enforce(sliceId, "agent-c");
    expect(isOk(result)).toBe(true);
  });

  it("returns ok when executor set is empty — no checkpoint (AC3)", async () => {
    const port = new StubExecutorQueryPort(ok(new Set<string>()));
    const service = new FreshReviewerService(port);

    const result = await service.enforce(sliceId, "agent-x");
    expect(isOk(result)).toBe(true);
  });

  it("propagates ExecutorQueryError — fail-closed (AC4)", async () => {
    const port = new StubExecutorQueryPort(err(new ExecutorQueryError("db down")));
    const service = new FreshReviewerService(port);

    const result = await service.enforce(sliceId, "agent-x");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ExecutorQueryError);
    }
  });

  it("includes executor set in violation error metadata (AC1)", async () => {
    const executors = new Set(["agent-a", "agent-b"]);
    const port = new StubExecutorQueryPort(ok(executors));
    const service = new FreshReviewerService(port);

    const result = await service.enforce(sliceId, "agent-a");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      const error = result.error as FreshReviewerViolationError;
      expect(error.metadata?.executors).toEqual(["agent-a", "agent-b"]);
    }
  });
});

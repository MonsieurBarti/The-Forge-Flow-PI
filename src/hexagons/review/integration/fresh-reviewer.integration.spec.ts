import { err, isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import {
  Checkpoint,
  GetSliceExecutorsUseCase,
  InMemoryCheckpointRepository,
} from "../../execution";
import { ExecutorQueryError } from "../domain/errors/executor-query.error";
import { FreshReviewerViolationError } from "../domain/errors/fresh-reviewer-violation.error";
import { FreshReviewerService } from "../domain/services/fresh-reviewer.service";
import { CachedExecutorQueryAdapter } from "../infrastructure/cached-executor-query.adapter";

describe("Fresh-Reviewer Integration", () => {
  const sliceId = crypto.randomUUID();
  const now = new Date();

  function setup() {
    const checkpointRepo = new InMemoryCheckpointRepository();
    const getExecutors = new GetSliceExecutorsUseCase(checkpointRepo);
    const adapter = new CachedExecutorQueryAdapter(async (id) => {
      const result = await getExecutors.execute(id);
      if (!result.ok) return err(new ExecutorQueryError(result.error.message));
      return result;
    });
    const service = new FreshReviewerService(adapter);
    return { checkpointRepo, service };
  }

  it("rejects reviewer who executed the slice (AC1)", async () => {
    const { checkpointRepo, service } = setup();
    const cp = Checkpoint.createNew({
      id: crypto.randomUUID(),
      sliceId,
      baseCommit: "abc123",
      now,
    });
    cp.recordTaskStart(crypto.randomUUID(), "agent-executor", now);
    checkpointRepo.seed(cp);

    const result = await service.enforce(sliceId, "agent-executor");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FreshReviewerViolationError);
    }
  });

  it("allows fresh reviewer (AC2)", async () => {
    const { checkpointRepo, service } = setup();
    const cp = Checkpoint.createNew({
      id: crypto.randomUUID(),
      sliceId,
      baseCommit: "abc123",
      now,
    });
    cp.recordTaskStart(crypto.randomUUID(), "agent-executor", now);
    checkpointRepo.seed(cp);

    const result = await service.enforce(sliceId, "agent-reviewer");
    expect(isOk(result)).toBe(true);
  });

  it("allows any reviewer when no checkpoint exists (AC3)", async () => {
    const { service } = setup();
    const result = await service.enforce(crypto.randomUUID(), "agent-any");
    expect(isOk(result)).toBe(true);
  });
});

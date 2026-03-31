import type { Result } from "@kernel";
import type { ExecutorQueryError } from "../errors/executor-query.error";
import type { FreshReviewerViolationError } from "../errors/fresh-reviewer-violation.error";
import type { ExecutorQueryPort } from "../ports/executor-query.port";

export class FreshReviewerService {
  constructor(private readonly port: ExecutorQueryPort) {}

  async enforce(
    sliceId: string,
    _candidate: string,
  ): Promise<Result<void, FreshReviewerViolationError | ExecutorQueryError>> {
    void this.port.getSliceExecutors(sliceId);
    throw new Error("Not implemented");
  }
}

import { err, ok, type Result } from "@kernel";
import type { ExecutorQueryError } from "../errors/executor-query.error";
import { FreshReviewerViolationError } from "../errors/fresh-reviewer-violation.error";
import type { ExecutorQueryPort } from "../ports/executor-query.port";

export class FreshReviewerService {
  constructor(private readonly executorQueryPort: ExecutorQueryPort) {}

  async enforce(
    sliceId: string,
    reviewerId: string,
  ): Promise<Result<void, FreshReviewerViolationError | ExecutorQueryError>> {
    const queryResult = await this.executorQueryPort.getSliceExecutors(sliceId);
    if (!queryResult.ok) return queryResult;

    const executors = queryResult.data;
    if (executors.has(reviewerId)) {
      return err(new FreshReviewerViolationError(reviewerId, sliceId, executors));
    }

    return ok(undefined);
  }
}

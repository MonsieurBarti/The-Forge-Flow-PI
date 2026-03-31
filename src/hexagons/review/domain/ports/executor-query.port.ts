import type { Result } from "@kernel";
import type { ExecutorQueryError } from "../errors/executor-query.error";

export abstract class ExecutorQueryPort {
  abstract getSliceExecutors(
    sliceId: string,
  ): Promise<Result<ReadonlySet<string>, ExecutorQueryError>>;
}

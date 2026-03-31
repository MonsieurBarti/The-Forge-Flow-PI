import type { Result } from "@kernel";
import type { ExecutorQueryError } from "../domain/errors/executor-query.error";
import { ExecutorQueryPort } from "../domain/ports/executor-query.port";

export class CachedExecutorQueryAdapter extends ExecutorQueryPort {
  constructor(
    _query: (sliceId: string) => Promise<Result<ReadonlySet<string>, ExecutorQueryError>>,
  ) {
    super();
  }

  getSliceExecutors(_sliceId: string): Promise<Result<ReadonlySet<string>, ExecutorQueryError>> {
    throw new Error("Not implemented");
  }
}

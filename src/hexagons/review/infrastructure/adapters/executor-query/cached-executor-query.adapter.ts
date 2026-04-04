import { ok, type Result } from "@kernel";
import type { ExecutorQueryError } from "../../../domain/errors/executor-query.error";
import { ExecutorQueryPort } from "../../../domain/ports/executor-query.port";

type QueryFn = (sliceId: string) => Promise<Result<ReadonlySet<string>, ExecutorQueryError>>;

export class CachedExecutorQueryAdapter extends ExecutorQueryPort {
  private readonly cache = new Map<string, ReadonlySet<string>>();

  constructor(private readonly queryFn: QueryFn) {
    super();
  }

  async getSliceExecutors(
    sliceId: string,
  ): Promise<Result<ReadonlySet<string>, ExecutorQueryError>> {
    const cached = this.cache.get(sliceId);
    if (cached) return ok(cached);

    const result = await this.queryFn(sliceId);
    if (result.ok) {
      this.cache.set(sliceId, result.data);
    }
    return result;
  }
}

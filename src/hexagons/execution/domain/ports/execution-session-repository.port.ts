import type { PersistenceError, Result } from "@kernel";
import type { ExecutionSession } from "../execution-session.aggregate";

export abstract class ExecutionSessionRepositoryPort {
  abstract save(session: ExecutionSession): Promise<Result<void, PersistenceError>>;
  abstract findBySliceId(
    sliceId: string,
  ): Promise<Result<ExecutionSession | null, PersistenceError>>;
  abstract delete(sliceId: string): Promise<Result<void, PersistenceError>>;
}

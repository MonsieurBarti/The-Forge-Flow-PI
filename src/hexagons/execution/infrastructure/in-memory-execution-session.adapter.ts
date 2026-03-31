import { ok, type PersistenceError, type Result } from "@kernel";
import { ExecutionSession } from "../domain/execution-session.aggregate";
import type { ExecutionSessionProps } from "../domain/execution-session.schemas";
import { ExecutionSessionRepositoryPort } from "../domain/ports/execution-session-repository.port";

export class InMemoryExecutionSessionAdapter extends ExecutionSessionRepositoryPort {
  private store = new Map<string, ExecutionSessionProps>();

  async save(session: ExecutionSession): Promise<Result<void, PersistenceError>> {
    this.store.set(session.sliceId, session.toJSON());
    return ok(undefined);
  }

  async findBySliceId(sliceId: string): Promise<Result<ExecutionSession | null, PersistenceError>> {
    const props = this.store.get(sliceId);
    if (!props) return ok(null);
    return ok(ExecutionSession.reconstitute(props));
  }

  async delete(sliceId: string): Promise<Result<void, PersistenceError>> {
    this.store.delete(sliceId);
    return ok(undefined);
  }

  seed(session: ExecutionSession): void {
    this.store.set(session.sliceId, session.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

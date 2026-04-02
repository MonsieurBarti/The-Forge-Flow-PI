import type { Id, PersistenceError, Result } from "@kernel";
import { VerificationRepositoryPort } from "../domain/ports/verification-repository.port";
import type { Verification } from "../domain/verification.aggregate";

export class SqliteVerificationRepository extends VerificationRepositoryPort {
  async save(_verification: Verification): Promise<Result<void, PersistenceError>> {
    throw new Error("Not implemented");
  }

  async findBySliceId(_sliceId: Id): Promise<Result<Verification[], PersistenceError>> {
    throw new Error("Not implemented");
  }
}

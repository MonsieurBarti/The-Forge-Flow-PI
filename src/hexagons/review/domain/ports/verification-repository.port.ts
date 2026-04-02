import type { Id, PersistenceError, Result } from "@kernel";
import type { Verification } from "../verification.aggregate";

export abstract class VerificationRepositoryPort {
  abstract save(verification: Verification): Promise<Result<void, PersistenceError>>;
  abstract findBySliceId(sliceId: Id): Promise<Result<Verification[], PersistenceError>>;
}

import { type Id, ok, type PersistenceError, type Result } from "@kernel";
import { VerificationRepositoryPort } from "../../../domain/ports/verification-repository.port";
import { Verification } from "../../../domain/aggregates/verification.aggregate";
import type { VerificationProps } from "../../../domain/schemas/verification.schemas";

export class InMemoryVerificationRepository extends VerificationRepositoryPort {
  private store = new Map<string, VerificationProps>();

  async save(verification: Verification): Promise<Result<void, PersistenceError>> {
    this.store.set(verification.id, verification.toJSON());
    return ok(undefined);
  }

  async findBySliceId(sliceId: Id): Promise<Result<Verification[], PersistenceError>> {
    const verifications: Verification[] = [];
    for (const props of this.store.values()) {
      if (props.sliceId === sliceId) {
        verifications.push(Verification.reconstitute(props));
      }
    }
    return ok(verifications);
  }

  seed(verification: Verification): void {
    this.store.set(verification.id, verification.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

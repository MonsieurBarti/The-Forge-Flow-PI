import type { Id, PersistenceError, Result } from "@kernel";
import type { Review } from "../aggregates/review.aggregate";

export abstract class ReviewRepositoryPort {
  abstract save(review: Review): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<Review | null, PersistenceError>>;
  abstract findBySliceId(sliceId: Id): Promise<Result<Review[], PersistenceError>>;
  abstract delete(id: Id): Promise<Result<void, PersistenceError>>;
  abstract findAll(): Promise<Result<Review[], PersistenceError>>;
  abstract reset(): void;
}

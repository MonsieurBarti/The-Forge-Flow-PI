import type { Id, PersistenceError, Result } from "@kernel";
import { ReviewRepositoryPort } from "../../../domain/ports/review-repository.port";
import type { Review } from "../../../domain/aggregates/review.aggregate";

export class SqliteReviewRepository extends ReviewRepositoryPort {
  save(_review: Review): Promise<Result<void, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findById(_id: Id): Promise<Result<Review | null, PersistenceError>> {
    throw new Error("Not implemented");
  }

  findBySliceId(_sliceId: Id): Promise<Result<Review[], PersistenceError>> {
    throw new Error("Not implemented");
  }

  delete(_id: Id): Promise<Result<void, PersistenceError>> {
    throw new Error("Not implemented");
  }
}

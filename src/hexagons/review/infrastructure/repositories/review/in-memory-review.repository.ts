import { type Id, ok, type PersistenceError, type Result } from "@kernel";
import { ReviewRepositoryPort } from "../../../domain/ports/review-repository.port";
import { Review } from "../../../domain/aggregates/review.aggregate";
import type { ReviewProps } from "../../../domain/schemas/review.schemas";

export class InMemoryReviewRepository extends ReviewRepositoryPort {
  private store = new Map<string, ReviewProps>();

  async save(review: Review): Promise<Result<void, PersistenceError>> {
    this.store.set(review.id, review.toJSON());
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<Review | null, PersistenceError>> {
    const props = this.store.get(id);
    if (!props) return ok(null);
    return ok(Review.reconstitute(props));
  }

  async findBySliceId(sliceId: Id): Promise<Result<Review[], PersistenceError>> {
    const reviews: Review[] = [];
    for (const props of this.store.values()) {
      if (props.sliceId === sliceId) {
        reviews.push(Review.reconstitute(props));
      }
    }
    return ok(reviews);
  }

  async delete(id: Id): Promise<Result<void, PersistenceError>> {
    this.store.delete(id);
    return ok(undefined);
  }

  async findAll(): Promise<Result<Review[], PersistenceError>> {
    return ok(Array.from(this.store.values()).map((p) => Review.reconstitute(p)));
  }

  seed(review: Review): void {
    this.store.set(review.id, review.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}

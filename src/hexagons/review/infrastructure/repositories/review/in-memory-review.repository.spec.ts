import { faker } from "@faker-js/faker";
import { beforeEach, describe, expect, it } from "vitest";

import { ReviewBuilder } from "../../../domain/builders/review.builder";
import { InMemoryReviewRepository } from "./in-memory-review.repository";

describe("InMemoryReviewRepository", () => {
  let repo: InMemoryReviewRepository;
  beforeEach(() => {
    repo = new InMemoryReviewRepository();
  });

  it("save + findById round-trip (AC15)", async () => {
    const review = new ReviewBuilder().build();
    await repo.save(review);
    const result = await repo.findById(review.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.id).toBe(review.id);
    expect(result.data?.role).toBe(review.role);
  });

  it("delete removes review (AC15)", async () => {
    const review = new ReviewBuilder().build();
    await repo.save(review);
    await repo.delete(review.id);
    const result = await repo.findById(review.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("findBySliceId returns all reviews for a slice (AC16)", async () => {
    const sliceId = faker.string.uuid();
    const r1 = new ReviewBuilder().withSliceId(sliceId).withRole("code-reviewer").build();
    const r2 = new ReviewBuilder().withSliceId(sliceId).withRole("security-auditor").build();
    const r3 = new ReviewBuilder().withSliceId(faker.string.uuid()).build();
    await repo.save(r1);
    await repo.save(r2);
    await repo.save(r3);
    const result = await repo.findBySliceId(sliceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
  });

  it("findById returns null for missing id", async () => {
    const result = await repo.findById(faker.string.uuid());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });
});

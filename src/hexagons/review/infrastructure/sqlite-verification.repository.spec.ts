import { describe, expect, it } from "vitest";
import { SqliteVerificationRepository } from "./sqlite-verification.repository";

describe("SqliteVerificationRepository", () => {
  it("extends VerificationRepositoryPort", () => {
    const repo = new SqliteVerificationRepository();
    expect(repo).toBeDefined();
  });

  it("save throws not implemented", async () => {
    const repo = new SqliteVerificationRepository();
    await expect(repo.save(null as never)).rejects.toThrow("Not implemented");
  });

  it("findBySliceId throws not implemented", async () => {
    const repo = new SqliteVerificationRepository();
    await expect(repo.findBySliceId("x")).rejects.toThrow("Not implemented");
  });
});

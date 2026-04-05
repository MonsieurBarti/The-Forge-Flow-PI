import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { isOk } from "@kernel";
import { Verification } from "../../../domain/aggregates/verification.aggregate";
import type { VerificationRepositoryPort } from "../../../domain/ports/verification-repository.port";
import { InMemoryVerificationRepository } from "./in-memory-verification.repository";
import { SqliteVerificationRepository } from "./sqlite-verification.repository";

const NOW = new Date("2026-04-05T10:00:00Z");

function makeVerification(params: {
  id: string;
  sliceId: string;
  fixCycleIndex?: number;
}): Verification {
  const v = Verification.createNew({
    id: params.id,
    sliceId: params.sliceId,
    agentIdentity: "opus",
    fixCycleIndex: params.fixCycleIndex ?? 0,
    now: NOW,
  });
  v.recordCriteria([
    { criterion: "Tests pass", verdict: "PASS", evidence: "All 42 tests green" },
    { criterion: "No lint errors", verdict: "FAIL", evidence: "2 warnings found" },
  ]);
  return v;
}

function runContractTests(
  name: string,
  factory: () => VerificationRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: VerificationRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findBySliceId roundtrip", async () => {
      const sliceId = crypto.randomUUID();
      const v = makeVerification({ id: crypto.randomUUID(), sliceId });

      await repo.save(v);

      const result = await repo.findBySliceId(sliceId);
      expect(isOk(result)).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0].toJSON()).toEqual(v.toJSON());
    });

    it("findBySliceId returns empty array for unknown slice", async () => {
      const result = await repo.findBySliceId(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(0);
    });

    it("findAll returns all verifications", async () => {
      const v1 = makeVerification({ id: crypto.randomUUID(), sliceId: crypto.randomUUID() });
      const v2 = makeVerification({ id: crypto.randomUUID(), sliceId: crypto.randomUUID() });
      await repo.save(v1);
      await repo.save(v2);

      const result = await repo.findAll();
      expect(isOk(result)).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(2);
    });

    it("reset clears all verifications", async () => {
      await repo.save(
        makeVerification({ id: crypto.randomUUID(), sliceId: crypto.randomUUID() }),
      );
      repo.reset();

      const result = await repo.findAll();
      expect(isOk(result)).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([]);
    });

    it("criteria JSON survives roundtrip", async () => {
      const sliceId = crypto.randomUUID();
      const v = makeVerification({ id: crypto.randomUUID(), sliceId });

      await repo.save(v);

      const result = await repo.findBySliceId(sliceId);
      expect(isOk(result)).toBe(true);
      if (!result.ok) return;
      const found = result.data[0];
      expect(found.criteria).toEqual(v.criteria);
      expect(found.criteria).toHaveLength(2);
      expect(found.criteria[0]).toEqual({
        criterion: "Tests pass",
        verdict: "PASS",
        evidence: "All 42 tests green",
      });
      expect(found.criteria[1]).toEqual({
        criterion: "No lint errors",
        verdict: "FAIL",
        evidence: "2 warnings found",
      });
    });

    it("save overwrites existing verification (upsert)", async () => {
      const sliceId = crypto.randomUUID();
      const id = crypto.randomUUID();
      const v = makeVerification({ id, sliceId });

      await repo.save(v);

      // Mutate criteria and re-save
      v.recordCriteria([
        { criterion: "Tests pass", verdict: "PASS", evidence: "All 50 tests green" },
      ]);
      await repo.save(v);

      const result = await repo.findBySliceId(sliceId);
      expect(isOk(result)).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0].criteria).toHaveLength(1);
      expect(result.data[0].overallVerdict).toBe("PASS");
    });
  });
}

runContractTests("InMemoryVerificationRepository", () => new InMemoryVerificationRepository());

runContractTests(
  "SqliteVerificationRepository",
  () => new SqliteVerificationRepository(new Database(":memory:")),
);

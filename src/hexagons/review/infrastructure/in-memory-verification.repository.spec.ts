import { describe, expect, it } from "vitest";
import { Verification } from "../domain/verification.aggregate";
import { InMemoryVerificationRepository } from "./in-memory-verification.repository";

const NOW = new Date("2026-04-01T12:00:00Z");

describe("InMemoryVerificationRepository", () => {
  it("save + findBySliceId round-trips", async () => {
    const repo = new InMemoryVerificationRepository();
    const sliceId = crypto.randomUUID();
    const v = Verification.createNew({
      id: crypto.randomUUID(),
      sliceId,
      agentIdentity: "verifier-1",
      fixCycleIndex: 0,
      now: NOW,
    });
    v.recordCriteria([{ criterion: "AC1", verdict: "PASS", evidence: "ok" }]);

    const saveResult = await repo.save(v);
    expect(saveResult.ok).toBe(true);

    const findResult = await repo.findBySliceId(sliceId);
    expect(findResult.ok).toBe(true);
    if (findResult.ok) {
      expect(findResult.data).toHaveLength(1);
      expect(findResult.data[0].id).toBe(v.id);
      expect(findResult.data[0].overallVerdict).toBe("PASS");
    }
  });

  it("returns empty array for unknown sliceId", async () => {
    const repo = new InMemoryVerificationRepository();
    const result = await repo.findBySliceId("nonexistent");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(0);
  });

  it("stores multiple verifications per slice", async () => {
    const repo = new InMemoryVerificationRepository();
    const sliceId = crypto.randomUUID();
    const v0 = Verification.createNew({
      id: crypto.randomUUID(),
      sliceId,
      agentIdentity: "v-1",
      fixCycleIndex: 0,
      now: NOW,
    });
    const v1 = Verification.createNew({
      id: crypto.randomUUID(),
      sliceId,
      agentIdentity: "v-2",
      fixCycleIndex: 1,
      now: NOW,
    });

    await repo.save(v0);
    await repo.save(v1);

    const result = await repo.findBySliceId(sliceId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(2);
  });

  it("seed and reset work", async () => {
    const repo = new InMemoryVerificationRepository();
    const v = Verification.createNew({
      id: crypto.randomUUID(),
      sliceId: crypto.randomUUID(),
      agentIdentity: "v-1",
      fixCycleIndex: 0,
      now: NOW,
    });
    repo.seed(v);
    const r1 = await repo.findBySliceId(v.sliceId);
    expect(r1.ok && r1.data.length).toBe(1);

    repo.reset();
    const r2 = await repo.findBySliceId(v.sliceId);
    expect(r2.ok && r2.data.length).toBe(0);
  });
});

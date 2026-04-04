import { describe, expect, it } from "vitest";
import { Verification } from "./verification.aggregate";
import type { CriterionVerdictProps } from "../schemas/verification.schemas";

const NOW = new Date("2026-04-01T12:00:00Z");
const ID = crypto.randomUUID();
const SLICE_ID = crypto.randomUUID();

describe("Verification", () => {
  it("createNew initializes with empty criteria and PASS verdict", () => {
    const v = Verification.createNew({
      id: ID,
      sliceId: SLICE_ID,
      agentIdentity: "verifier-1",
      fixCycleIndex: 0,
      now: NOW,
    });
    expect(v.id).toBe(ID);
    expect(v.sliceId).toBe(SLICE_ID);
    expect(v.agentIdentity).toBe("verifier-1");
    expect(v.overallVerdict).toBe("PASS");
    expect(v.criteria).toEqual([]);
    expect(v.passCount).toBe(0);
    expect(v.failCount).toBe(0);
    expect(v.fixCycleIndex).toBe(0);
    expect(v.createdAt).toEqual(NOW);
  });

  it("recordCriteria computes overallVerdict as PASS when all pass", () => {
    const v = Verification.createNew({
      id: ID,
      sliceId: SLICE_ID,
      agentIdentity: "verifier-1",
      fixCycleIndex: 0,
      now: NOW,
    });
    const criteria: CriterionVerdictProps[] = [
      { criterion: "AC1: tests pass", verdict: "PASS", evidence: "npx vitest -> 10/10" },
      { criterion: "AC2: type checks", verdict: "PASS", evidence: "tsc --noEmit -> 0 errors" },
    ];
    v.recordCriteria(criteria);
    expect(v.overallVerdict).toBe("PASS");
    expect(v.passCount).toBe(2);
    expect(v.failCount).toBe(0);
    expect(v.criteria).toHaveLength(2);
  });

  it("recordCriteria computes overallVerdict as FAIL when any fails", () => {
    const v = Verification.createNew({
      id: ID,
      sliceId: SLICE_ID,
      agentIdentity: "verifier-1",
      fixCycleIndex: 0,
      now: NOW,
    });
    const criteria: CriterionVerdictProps[] = [
      { criterion: "AC1", verdict: "PASS", evidence: "ok" },
      { criterion: "AC2", verdict: "FAIL", evidence: "missing implementation" },
    ];
    v.recordCriteria(criteria);
    expect(v.overallVerdict).toBe("FAIL");
    expect(v.passCount).toBe(1);
    expect(v.failCount).toBe(1);
  });

  it("empty criteria after recordCriteria results in FAIL", () => {
    const v = Verification.createNew({
      id: ID,
      sliceId: SLICE_ID,
      agentIdentity: "verifier-1",
      fixCycleIndex: 0,
      now: NOW,
    });
    v.recordCriteria([]);
    expect(v.overallVerdict).toBe("FAIL");
  });

  it("reconstitute hydrates from props", () => {
    const v = Verification.createNew({
      id: ID,
      sliceId: SLICE_ID,
      agentIdentity: "verifier-1",
      fixCycleIndex: 0,
      now: NOW,
    });
    v.recordCriteria([{ criterion: "AC1", verdict: "PASS", evidence: "ok" }]);
    const json = v.toJSON();
    const v2 = Verification.reconstitute(json);
    expect(v2.id).toBe(ID);
    expect(v2.overallVerdict).toBe("PASS");
    expect(v2.criteria).toHaveLength(1);
  });

  it("toJSON round-trips through reconstitute", () => {
    const v = Verification.createNew({
      id: ID,
      sliceId: SLICE_ID,
      agentIdentity: "verifier-1",
      fixCycleIndex: 1,
      now: NOW,
    });
    v.recordCriteria([{ criterion: "AC1", verdict: "FAIL", evidence: "err" }]);
    const json = v.toJSON();
    const v2 = Verification.reconstitute(json);
    expect(v2.toJSON()).toEqual(json);
  });
});

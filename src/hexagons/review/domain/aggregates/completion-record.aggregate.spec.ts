import { describe, expect, it } from "vitest";
import type { AuditReportProps } from "../schemas/completion.schemas";
import { CompletionRecord } from "./completion-record.aggregate";

const NOW = new Date("2026-04-02T12:00:00Z");
const ID = crypto.randomUUID();
const MILESTONE_ID = crypto.randomUUID();

const AUDIT_REPORTS: AuditReportProps[] = [
  {
    agentType: "tff-spec-reviewer",
    verdict: "PASS",
    findings: [],
    summary: "All specs satisfied",
  },
  {
    agentType: "tff-security-auditor",
    verdict: "PASS",
    findings: [],
    summary: "No security issues found",
  },
];

function makeRecord(overrides?: { auditReports?: AuditReportProps[] }) {
  return CompletionRecord.createNew({
    id: ID,
    milestoneId: MILESTONE_ID,
    milestoneLabel: "M05",
    prNumber: 99,
    prUrl: "https://github.com/org/repo/pull/99",
    headBranch: "milestone/M05",
    baseBranch: "main",
    auditReports: overrides?.auditReports ?? AUDIT_REPORTS,
    now: NOW,
  });
}

describe("CompletionRecord", () => {
  it("createNew sets initial state (outcome null, fixCyclesUsed 0, completedAt null)", () => {
    const r = makeRecord();
    expect(r.id).toBe(ID);
    expect(r.isMerged).toBe(false);
    expect(r.isAborted).toBe(false);
    const json = r.toJSON();
    expect(json.outcome).toBeNull();
    expect(json.fixCyclesUsed).toBe(0);
    expect(json.completedAt).toBeNull();
  });

  it("createNew stores auditReports", () => {
    const r = makeRecord();
    expect(r.auditReports).toEqual(AUDIT_REPORTS);
    expect(r.auditReports).toHaveLength(2);
  });

  it("recordMerge sets outcome='merged', completedAt, fixCyclesUsed", () => {
    const r = makeRecord();
    const mergedAt = new Date("2026-04-02T13:00:00Z");
    r.recordMerge(3, mergedAt);
    expect(r.isMerged).toBe(true);
    expect(r.isAborted).toBe(false);
    const json = r.toJSON();
    expect(json.outcome).toBe("merged");
    expect(json.fixCyclesUsed).toBe(3);
    expect(json.completedAt).toEqual(mergedAt);
  });

  it("recordMerge throws if outcome already set", () => {
    const r = makeRecord();
    r.recordAbort(NOW);
    expect(() => r.recordMerge(0, NOW)).toThrow();
  });

  it("recordAbort sets outcome='abort', completedAt", () => {
    const r = makeRecord();
    const abortedAt = new Date("2026-04-02T14:00:00Z");
    r.recordAbort(abortedAt);
    expect(r.isAborted).toBe(true);
    expect(r.isMerged).toBe(false);
    const json = r.toJSON();
    expect(json.outcome).toBe("abort");
    expect(json.completedAt).toEqual(abortedAt);
  });

  it("recordAbort throws if outcome already set", () => {
    const r = makeRecord();
    r.recordMerge(0, NOW);
    expect(() => r.recordAbort(NOW)).toThrow();
  });

  it("reconstitute hydrates from props correctly", () => {
    const r = makeRecord();
    r.recordMerge(2, NOW);
    const json = r.toJSON();
    const r2 = CompletionRecord.reconstitute(json);
    expect(r2.toJSON()).toEqual(json);
    expect(r2.id).toBe(ID);
    expect(r2.milestoneId).toBe(MILESTONE_ID);
    expect(r2.milestoneLabel).toBe("M05");
    expect(r2.isMerged).toBe(true);
  });

  it("isMerged returns true only when outcome is 'merged'", () => {
    const r = makeRecord();
    expect(r.isMerged).toBe(false);
    r.recordMerge(0, NOW);
    expect(r.isMerged).toBe(true);
  });

  it("isAborted returns true only when outcome is 'abort'", () => {
    const r = makeRecord();
    expect(r.isAborted).toBe(false);
    r.recordAbort(NOW);
    expect(r.isAborted).toBe(true);
  });

  it("toJSON returns serializable props", () => {
    const r = makeRecord();
    const json = r.toJSON();
    expect(json.id).toBe(ID);
    expect(json.milestoneId).toBe(MILESTONE_ID);
    expect(json.milestoneLabel).toBe("M05");
    expect(json.prNumber).toBe(99);
    expect(json.prUrl).toBe("https://github.com/org/repo/pull/99");
    expect(json.headBranch).toBe("milestone/M05");
    expect(json.baseBranch).toBe("main");
    expect(json.auditReports).toEqual(AUDIT_REPORTS);
    expect(json.outcome).toBeNull();
    expect(json.fixCyclesUsed).toBe(0);
    expect(json.createdAt).toEqual(NOW);
    expect(json.completedAt).toBeNull();
  });
});

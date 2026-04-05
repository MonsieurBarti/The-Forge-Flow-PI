import { describe, expect, it } from "vitest";
import {
  type RecoveryReport,
  RecoveryReportSchema,
  type RecoveryScenario,
  RecoveryScenarioSchema,
  type RecoveryType,
  RecoveryTypeSchema,
} from "./recovery.schemas";

describe("RecoveryTypeSchema", () => {
  it("accepts all 6 valid types", () => {
    const types: RecoveryType[] = [
      "crash",
      "mismatch",
      "rename",
      "fresh-clone",
      "untracked",
      "healthy",
    ];
    for (const t of types) {
      expect(RecoveryTypeSchema.parse(t)).toBe(t);
    }
  });

  it("rejects invalid type", () => {
    expect(() => RecoveryTypeSchema.parse("invalid")).toThrow();
  });
});

describe("RecoveryScenarioSchema", () => {
  it("accepts valid scenario with branch", () => {
    const scenario: RecoveryScenario = {
      type: "crash",
      currentBranch: "main",
      branchMeta: null,
      backupPaths: ["/tmp/.tff.backup.2026-01-01T00-00-00-000Z"],
      stateBranchExists: true,
      parentStateBranch: "tff-state/main",
    };
    expect(RecoveryScenarioSchema.parse(scenario)).toEqual(scenario);
  });

  it("accepts null currentBranch (detached HEAD)", () => {
    const scenario = {
      type: "healthy",
      currentBranch: null,
      branchMeta: null,
      backupPaths: [],
      stateBranchExists: false,
      parentStateBranch: null,
    };
    expect(RecoveryScenarioSchema.parse(scenario)).toEqual(scenario);
  });

  it("rejects missing required fields", () => {
    expect(() => RecoveryScenarioSchema.parse({ type: "crash" })).toThrow();
  });
});

describe("RecoveryReportSchema", () => {
  it("accepts valid report", () => {
    const report: RecoveryReport = {
      type: "crash",
      action: "restored",
      source: "/tmp/.tff.backup.2026-01-01T00-00-00-000Z",
      filesRestored: 5,
      warnings: [],
    };
    expect(RecoveryReportSchema.parse(report)).toEqual(report);
  });

  it("accepts all action types", () => {
    const actions = ["restored", "renamed", "created-fresh", "skipped", "none"] as const;
    for (const action of actions) {
      const report = {
        type: "healthy" as const,
        action,
        source: "",
        filesRestored: 0,
        warnings: [],
      };
      expect(RecoveryReportSchema.parse(report).action).toBe(action);
    }
  });

  it("rejects invalid action", () => {
    expect(() =>
      RecoveryReportSchema.parse({
        type: "crash",
        action: "invalid",
        source: "",
        filesRestored: 0,
        warnings: [],
      }),
    ).toThrow();
  });
});

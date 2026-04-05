import { err, ok, type Result } from "@kernel";
import { GitError } from "@kernel/errors";
import type { DateProviderPort } from "@kernel/ports";
import type { GitPort } from "@kernel/ports/git.port";
import { describe, expect, it, vi } from "vitest";
import { AuditError } from "../domain/errors/audit.error";
import type { MilestoneQueryError } from "../domain/errors/milestone-query.error";
import { AuditPort } from "../domain/ports/audit.port";
import {
  MilestoneQueryPort,
  type MilestoneSliceStatus,
} from "../domain/ports/milestone-query.port";
import type { AuditReportProps } from "../domain/schemas/completion.schemas";
import type { FindingProps } from "../domain/schemas/review.schemas";
import { InMemoryMilestoneAuditRecordRepository } from "../infrastructure/repositories/milestone-audit-record/in-memory-milestone-audit-record.repository";
import {
  type AuditMilestoneInput,
  AuditMilestoneUseCase,
  DIFF_SIZE_LIMIT,
} from "./audit-milestone.use-case";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MILESTONE_ID = "550e8400-e29b-41d4-a716-446655440000";
const MILESTONE_LABEL = "M07";
const WORKING_DIR = "/tmp/worktree";
const HEAD_BRANCH = "milestone/M07";
const BASE_BRANCH = "main";
const FIXED_DATE = new Date("2026-04-05T12:00:00.000Z");

const DEFAULT_INPUT: AuditMilestoneInput = {
  milestoneId: MILESTONE_ID,
  milestoneLabel: MILESTONE_LABEL,
  headBranch: HEAD_BRANCH,
  baseBranch: BASE_BRANCH,
  workingDirectory: WORKING_DIR,
};

const STUB_AUDIT_REPORT_PASS: AuditReportProps = {
  agentType: "spec-reviewer",
  verdict: "PASS",
  findings: [],
  summary: "All requirements met.",
};

const STUB_SECURITY_REPORT_PASS: AuditReportProps = {
  agentType: "security-auditor",
  verdict: "PASS",
  findings: [],
  summary: "No security issues found.",
};

const STUB_FINDING: FindingProps = {
  id: "f0000000-0000-4000-8000-000000000001",
  severity: "high",
  message: "Missing input validation",
  filePath: "src/handler.ts",
  lineStart: 42,
};

const STUB_SECURITY_REPORT_FAIL: AuditReportProps = {
  agentType: "security-auditor",
  verdict: "FAIL",
  findings: [STUB_FINDING],
  summary: "Security issue found.",
};

// ---------------------------------------------------------------------------
// Stub ports
// ---------------------------------------------------------------------------
class StubMilestoneQueryPort extends MilestoneQueryPort {
  private _sliceStatuses: Result<MilestoneSliceStatus[], MilestoneQueryError> = ok([
    { sliceId: "s1", sliceLabel: "M07-S01", status: "closed" },
    { sliceId: "s2", sliceLabel: "M07-S02", status: "closed" },
  ]);
  private _milestoneStatus: Result<string, MilestoneQueryError> = ok("in_progress");
  private _requirementsContent: Result<string, MilestoneQueryError> = ok("requirements content");

  withSliceStatuses(result: Result<MilestoneSliceStatus[], MilestoneQueryError>): this {
    this._sliceStatuses = result;
    return this;
  }

  withMilestoneStatus(result: Result<string, MilestoneQueryError>): this {
    this._milestoneStatus = result;
    return this;
  }

  withRequirementsContent(result: Result<string, MilestoneQueryError>): this {
    this._requirementsContent = result;
    return this;
  }

  async getSliceStatuses(): Promise<Result<MilestoneSliceStatus[], MilestoneQueryError>> {
    return this._sliceStatuses;
  }

  async getMilestoneStatus(): Promise<Result<string, MilestoneQueryError>> {
    return this._milestoneStatus;
  }

  async getRequirementsContent(): Promise<Result<string, MilestoneQueryError>> {
    return this._requirementsContent;
  }
}

class StubAuditPort extends AuditPort {
  readonly auditCalls: Array<{
    milestoneLabel: string;
    agentType: string;
    diffContent: string;
  }> = [];
  private _results: Array<Result<AuditReportProps, AuditError>> = [];
  private _callIndex = 0;

  withResult(result: Result<AuditReportProps, AuditError>): this {
    this._results.push(result);
    return this;
  }

  async auditMilestone(params: {
    milestoneLabel: string;
    requirementsContent: string;
    diffContent: string;
    agentType: "spec-reviewer" | "security-auditor";
  }): Promise<Result<AuditReportProps, AuditError>> {
    this.auditCalls.push({
      milestoneLabel: params.milestoneLabel,
      agentType: params.agentType,
      diffContent: params.diffContent,
    });
    const idx = this._callIndex++;
    if (idx < this._results.length) {
      return this._results[idx];
    }
    if (params.agentType === "spec-reviewer") {
      return ok(STUB_AUDIT_REPORT_PASS);
    }
    return ok(STUB_SECURITY_REPORT_PASS);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
class FixedDateProvider implements DateProviderPort {
  now(): Date {
    return FIXED_DATE;
  }
}

let idCounter = 0;
function resetIdCounter(): void {
  idCounter = 0;
}
function deterministicId(): string {
  return `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`;
}

function makeStubGitPort(overrides?: { diffResult?: Result<string, GitError> }): GitPort {
  return {
    diffAgainst: vi.fn().mockResolvedValue(overrides?.diffResult ?? ok("diff content")),
  } as unknown as GitPort;
}

interface BuildUseCaseOverrides {
  milestoneQueryPort?: StubMilestoneQueryPort;
  auditPort?: StubAuditPort;
  gitPort?: GitPort;
  auditRecordRepo?: InMemoryMilestoneAuditRecordRepository;
}

function buildUseCase(overrides?: BuildUseCaseOverrides) {
  resetIdCounter();
  const milestoneQueryPort = overrides?.milestoneQueryPort ?? new StubMilestoneQueryPort();
  const auditPort = overrides?.auditPort ?? new StubAuditPort();
  const auditRecordRepo =
    overrides?.auditRecordRepo ?? new InMemoryMilestoneAuditRecordRepository();
  const gitPort = overrides?.gitPort ?? makeStubGitPort();
  const dateProvider = new FixedDateProvider();

  const useCase = new AuditMilestoneUseCase(
    milestoneQueryPort,
    auditPort,
    auditRecordRepo,
    gitPort,
    dateProvider,
    deterministicId,
  );

  return { useCase, milestoneQueryPort, auditPort, auditRecordRepo, gitPort };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AuditMilestoneUseCase", () => {
  describe("happy path — both audits PASS", () => {
    it("returns allPassed=true, unresolvedCount=0, and persists record", async () => {
      const { useCase, auditRecordRepo } = buildUseCase();

      const result = await useCase.execute(DEFAULT_INPUT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.milestoneId).toBe(MILESTONE_ID);
      expect(result.data.milestoneLabel).toBe(MILESTONE_LABEL);
      expect(result.data.allPassed).toBe(true);
      expect(result.data.unresolvedCount).toBe(0);
      expect(result.data.auditReports).toHaveLength(2);
      expect(result.data.auditedAt).toBe(FIXED_DATE.toISOString());

      // Verify record was persisted
      const findResult = await auditRecordRepo.findLatestByMilestoneId(MILESTONE_ID);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;
      expect(findResult.data).not.toBeNull();
      if (!findResult.data) return;
      expect(findResult.data.milestoneId).toBe(MILESTONE_ID);
      expect(findResult.data.allPassed).toBe(true);
    });

    it("dispatches both spec-reviewer and security-auditor in parallel", async () => {
      const auditPort = new StubAuditPort();
      const { useCase } = buildUseCase({ auditPort });

      await useCase.execute(DEFAULT_INPUT);

      expect(auditPort.auditCalls).toHaveLength(2);
      expect(auditPort.auditCalls[0].agentType).toBe("spec-reviewer");
      expect(auditPort.auditCalls[1].agentType).toBe("security-auditor");
    });
  });

  describe("one audit FAILS", () => {
    it("returns allPassed=false with unresolvedCount > 0", async () => {
      const auditPort = new StubAuditPort()
        .withResult(ok(STUB_AUDIT_REPORT_PASS))
        .withResult(ok(STUB_SECURITY_REPORT_FAIL));

      const { useCase } = buildUseCase({ auditPort });

      const result = await useCase.execute(DEFAULT_INPUT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.allPassed).toBe(false);
      expect(result.data.unresolvedCount).toBe(1);
      expect(result.data.auditReports[1].verdict).toBe("FAIL");
    });
  });

  describe("guard: unclosed slices", () => {
    it("returns error when slices are not all closed", async () => {
      const milestoneQueryPort = new StubMilestoneQueryPort().withSliceStatuses(
        ok([
          { sliceId: "s1", sliceLabel: "M07-S01", status: "closed" },
          { sliceId: "s2", sliceLabel: "M07-S02", status: "executing" },
        ]),
      );

      const { useCase } = buildUseCase({ milestoneQueryPort });

      const result = await useCase.execute(DEFAULT_INPUT);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("AUDIT.OPEN_SLICES_REMAINING");
      expect(result.error.message).toContain("1 slice(s) not closed");
    });
  });

  describe("guard: milestone not in_progress", () => {
    it("returns error when milestone status is not in_progress", async () => {
      const milestoneQueryPort = new StubMilestoneQueryPort().withMilestoneStatus(ok("completed"));

      const { useCase } = buildUseCase({ milestoneQueryPort });

      const result = await useCase.execute(DEFAULT_INPUT);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("AUDIT.INVALID_MILESTONE_STATUS");
      expect(result.error.message).toContain("got: completed");
    });
  });

  describe("diff truncation at 100KB", () => {
    it("truncates diff when exceeding DIFF_SIZE_LIMIT", async () => {
      const largeDiff = "x".repeat(DIFF_SIZE_LIMIT + 5_000);
      const gitPort = makeStubGitPort({ diffResult: ok(largeDiff) });
      const auditPort = new StubAuditPort();

      const { useCase } = buildUseCase({ gitPort, auditPort });

      const result = await useCase.execute(DEFAULT_INPUT);

      expect(result.ok).toBe(true);

      // Both audit calls should receive the truncated diff
      for (const call of auditPort.auditCalls) {
        expect(call.diffContent.length).toBeLessThan(largeDiff.length);
        expect(call.diffContent).toContain("[... diff truncated at 100KB ...]");
        expect(call.diffContent.length).toBe(
          DIFF_SIZE_LIMIT + "\n\n[... diff truncated at 100KB ...]".length,
        );
      }
    });

    it("does not truncate diff under the limit", async () => {
      const smallDiff = "y".repeat(1_000);
      const gitPort = makeStubGitPort({ diffResult: ok(smallDiff) });
      const auditPort = new StubAuditPort();

      const { useCase } = buildUseCase({ gitPort, auditPort });

      await useCase.execute(DEFAULT_INPUT);

      for (const call of auditPort.auditCalls) {
        expect(call.diffContent).toBe(smallDiff);
      }
    });
  });

  describe("audit dispatch failure", () => {
    it("returns error when spec-reviewer dispatch fails", async () => {
      const auditPort = new StubAuditPort().withResult(
        err(AuditError.dispatchFailed("spec-reviewer", new Error("network timeout"))),
      );

      const { useCase } = buildUseCase({ auditPort });

      const result = await useCase.execute(DEFAULT_INPUT);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("AUDIT.FAILED");
      expect(result.error.message).toContain("network timeout");
    });

    it("returns error when security-auditor dispatch fails", async () => {
      const auditPort = new StubAuditPort()
        .withResult(ok(STUB_AUDIT_REPORT_PASS))
        .withResult(err(AuditError.dispatchFailed("security-auditor", new Error("agent crashed"))));

      const { useCase } = buildUseCase({ auditPort });

      const result = await useCase.execute(DEFAULT_INPUT);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("AUDIT.FAILED");
      expect(result.error.message).toContain("agent crashed");
    });
  });

  describe("git diff failure", () => {
    it("returns error when diff computation fails", async () => {
      const gitPort = makeStubGitPort({
        diffResult: err(new GitError("DIFF_FAILED", "fatal: bad revision")),
      });

      const { useCase } = buildUseCase({ gitPort });

      const result = await useCase.execute(DEFAULT_INPUT);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("AUDIT.FAILED");
    });
  });
});

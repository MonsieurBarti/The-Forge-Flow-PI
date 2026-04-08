import {
  type DomainEvent,
  err,
  InProcessEventBus,
  ok,
  type Result,
  SilentLoggerAdapter,
} from "@kernel";
import { GitError } from "@kernel/errors";
import type { DateProviderPort, EventBusPort } from "@kernel/ports";
import type { GitPort } from "@kernel/ports/git.port";
import type { GitHubPort } from "@kernel/ports/github.port";
import type { PullRequestInfo } from "@kernel/ports/github.schemas";
import { describe, expect, it, vi } from "vitest";
import { MilestoneAuditRecord } from "../domain/aggregates/milestone-audit-record.aggregate";
import { CompleteMilestoneError } from "../domain/errors/complete-milestone.error";
import type { MilestoneQueryError } from "../domain/errors/milestone-query.error";
import { MilestoneTransitionError } from "../domain/errors/milestone-transition.error";
import { MilestoneCompletedEvent } from "../domain/events/milestone-completed.event";
import type { MergeGateContext } from "../domain/ports/merge-gate.port";
import { MergeGatePort } from "../domain/ports/merge-gate.port";
import { MilestoneAuditRecordRepositoryPort } from "../domain/ports/milestone-audit-record-repository.port";
import {
  MilestoneQueryPort,
  type MilestoneSliceStatus,
} from "../domain/ports/milestone-query.port";
import { MilestoneTransitionPort } from "../domain/ports/milestone-transition.port";
import type { MergeGateDecision } from "../domain/schemas/ship.schemas";
import { InMemoryCompletionRecordRepository } from "../infrastructure/repositories/completion-record/in-memory-completion-record.repository";
import {
  CompleteMilestoneUseCase,
  DIFF_SIZE_LIMIT,
  truncateDiff,
} from "./complete-milestone.use-case";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MILESTONE_ID = "550e8400-e29b-41d4-a716-446655440000";
const MILESTONE_LABEL = "M05";
const MILESTONE_TITLE = "Review and Ship";
const WORKING_DIR = "/tmp/worktree";
const HEAD_BRANCH = "milestone/M05";
const BASE_BRANCH = "main";
const PR_URL = "https://github.com/org/repo/pull/42";
const PR_NUMBER = 42;
const FIXED_DATE = new Date("2026-04-01T12:00:00.000Z");

const STUB_PR_INFO: PullRequestInfo = {
  number: PR_NUMBER,
  title: `[${MILESTONE_LABEL}] ${MILESTONE_TITLE}`,
  url: PR_URL,
  state: "open",
  head: HEAD_BRANCH,
  base: BASE_BRANCH,
  createdAt: FIXED_DATE,
};

// ---------------------------------------------------------------------------
// Stub ports
// ---------------------------------------------------------------------------
class StubMilestoneQueryPort extends MilestoneQueryPort {
  private _sliceStatuses: Result<MilestoneSliceStatus[], MilestoneQueryError> = ok([
    { sliceId: "s1", sliceLabel: "M05-S01", status: "closed" },
    { sliceId: "s2", sliceLabel: "M05-S02", status: "closed" },
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

class StubAuditRecordRepo extends MilestoneAuditRecordRepositoryPort {
  record: MilestoneAuditRecord | null = null;

  async save(r: MilestoneAuditRecord) {
    this.record = r;
    return ok(undefined) as Result<void, never>;
  }
  async findLatestByMilestoneId() {
    return ok(this.record) as Result<MilestoneAuditRecord | null, never>;
  }
  reset() {
    this.record = null;
  }
}

function makePassingAuditRecord(milestoneId: string): MilestoneAuditRecord {
  return MilestoneAuditRecord.createNew({
    id: crypto.randomUUID(),
    milestoneId,
    milestoneLabel: MILESTONE_LABEL,
    auditReports: [
      { agentType: "tff-spec-reviewer", verdict: "PASS", findings: [], summary: "OK" },
      { agentType: "tff-security-auditor", verdict: "PASS", findings: [], summary: "OK" },
    ],
    now: FIXED_DATE,
  });
}

class StubMergeGatePort extends MergeGatePort {
  private _decisions: MergeGateDecision[] = [];
  private _callIndex = 0;
  readonly askCalls: MergeGateContext[] = [];

  withDecisions(...decisions: MergeGateDecision[]): this {
    this._decisions.push(...decisions);
    return this;
  }

  async askMergeStatus(context: MergeGateContext): Promise<MergeGateDecision> {
    this.askCalls.push(context);
    const idx = this._callIndex++;
    if (idx < this._decisions.length) {
      return this._decisions[idx];
    }
    return "merged";
  }
}

class StubMilestoneTransitionPort extends MilestoneTransitionPort {
  readonly closeCalls: string[] = [];
  private _result: Result<void, MilestoneTransitionError> = ok(undefined);

  withResult(result: Result<void, MilestoneTransitionError>): this {
    this._result = result;
    return this;
  }

  async close(milestoneId: string): Promise<Result<void, MilestoneTransitionError>> {
    this.closeCalls.push(milestoneId);
    return this._result;
  }
}

class SpyEventBus extends InProcessEventBus {
  readonly publishedEvents: DomainEvent[] = [];

  override async publish(event: DomainEvent): Promise<void> {
    this.publishedEvents.push(event);
    return super.publish(event);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const logger = new SilentLoggerAdapter();

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

function makeStubGitHubPort(overrides?: {
  listResult?: Result<PullRequestInfo[], unknown>;
  createResult?: Result<PullRequestInfo, unknown>;
}): GitHubPort {
  return {
    listPullRequests: vi.fn().mockResolvedValue(overrides?.listResult ?? ok([])),
    createPullRequest: vi.fn().mockResolvedValue(overrides?.createResult ?? ok(STUB_PR_INFO)),
    addComment: vi.fn().mockResolvedValue(ok(undefined)),
  } as unknown as GitHubPort;
}

function makeStubGitPort(overrides?: {
  diffResult?: Result<string, GitError>;
  pushResult?: Result<void, GitError>;
  listBranchesResult?: Result<string[], GitError>;
  deleteBranchResult?: Result<void, GitError>;
}): GitPort {
  return {
    diffAgainst: vi.fn().mockResolvedValue(overrides?.diffResult ?? ok("diff content")),
    pushFrom: vi.fn().mockResolvedValue(overrides?.pushResult ?? ok(undefined)),
    listBranches: vi.fn().mockResolvedValue(overrides?.listBranchesResult ?? ok([])),
    deleteBranch: vi.fn().mockResolvedValue(overrides?.deleteBranchResult ?? ok(undefined)),
  } as unknown as GitPort;
}

interface BuildUseCaseOverrides {
  milestoneQueryPort?: StubMilestoneQueryPort;
  auditRecordRepo?: StubAuditRecordRepo;
  gitHubPort?: GitHubPort;
  mergeGatePort?: StubMergeGatePort;
  completionRecordRepository?: InMemoryCompletionRecordRepository;
  gitPort?: GitPort;
  milestoneTransitionPort?: StubMilestoneTransitionPort;
  eventBus?: EventBusPort;
  dateProvider?: DateProviderPort;
  generateId?: () => string;
}

function buildUseCase(overrides: BuildUseCaseOverrides = {}): {
  useCase: CompleteMilestoneUseCase;
  milestoneQueryPort: StubMilestoneQueryPort;
  auditRecordRepo: StubAuditRecordRepo;
  mergeGatePort: StubMergeGatePort;
  completionRecordRepository: InMemoryCompletionRecordRepository;
  gitHubPort: GitHubPort;
  gitPort: GitPort;
  milestoneTransitionPort: StubMilestoneTransitionPort;
  eventBus: SpyEventBus;
} {
  const milestoneQueryPort = overrides.milestoneQueryPort ?? new StubMilestoneQueryPort();
  const auditRecordRepo =
    overrides.auditRecordRepo ??
    (() => {
      const repo = new StubAuditRecordRepo();
      repo.record = makePassingAuditRecord(MILESTONE_ID);
      return repo;
    })();
  const gitHubPort = overrides.gitHubPort ?? makeStubGitHubPort();
  const mergeGatePort = overrides.mergeGatePort ?? new StubMergeGatePort();
  const completionRecordRepository =
    overrides.completionRecordRepository ?? new InMemoryCompletionRecordRepository();
  const gitPort = overrides.gitPort ?? makeStubGitPort();
  const milestoneTransitionPort =
    overrides.milestoneTransitionPort ?? new StubMilestoneTransitionPort();
  const eventBus =
    overrides.eventBus instanceof SpyEventBus ? overrides.eventBus : new SpyEventBus(logger);
  const dateProvider = overrides.dateProvider ?? new FixedDateProvider();
  const generateId = overrides.generateId ?? deterministicId;

  const useCase = new CompleteMilestoneUseCase(
    milestoneQueryPort,
    auditRecordRepo,
    gitHubPort,
    mergeGatePort,
    completionRecordRepository,
    gitPort,
    milestoneTransitionPort,
    eventBus,
    dateProvider,
    generateId,
    logger,
  );

  return {
    useCase,
    milestoneQueryPort,
    auditRecordRepo,
    mergeGatePort,
    completionRecordRepository,
    gitHubPort,
    gitPort,
    milestoneTransitionPort,
    eventBus,
  };
}

function makeRequest(
  overrides?: Partial<{
    milestoneId: string;
    milestoneLabel: string;
    milestoneTitle: string;
    headBranch: string;
    baseBranch: string;
    workingDirectory: string;
    maxFixCycles: number;
  }>,
): {
  milestoneId: string;
  milestoneLabel: string;
  milestoneTitle: string;
  headBranch: string;
  baseBranch: string;
  workingDirectory: string;
  maxFixCycles: number;
} {
  return {
    milestoneId: MILESTONE_ID,
    milestoneLabel: MILESTONE_LABEL,
    milestoneTitle: MILESTONE_TITLE,
    headBranch: HEAD_BRANCH,
    baseBranch: BASE_BRANCH,
    workingDirectory: WORKING_DIR,
    maxFixCycles: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CompleteMilestoneUseCase", () => {
  describe("happy path: all slices closed, audits pass, PR created, merged", () => {
    it("returns ok with merged=true, saves CompletionRecord, emits MilestoneCompletedEvent", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("merged");
      const eventBus = new SpyEventBus(logger);

      const { useCase, completionRecordRepository } = buildUseCase({
        mergeGatePort: mergeGate,
        eventBus,
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.merged).toBe(true);
        expect(result.data.prNumber).toBe(PR_NUMBER);
        expect(result.data.prUrl).toBe(PR_URL);
        expect(result.data.fixCyclesUsed).toBe(0);
        expect(result.data.milestoneId).toBe(MILESTONE_ID);
        expect(result.data.auditReports).toHaveLength(2);
      }

      // Event emitted
      const completedEvents = eventBus.publishedEvents.filter(
        (e) => e instanceof MilestoneCompletedEvent,
      );
      expect(completedEvents).toHaveLength(1);
      const event = completedEvents[0] as MilestoneCompletedEvent;
      expect(event.milestoneId).toBe(MILESTONE_ID);
      expect(event.milestoneLabel).toBe(MILESTONE_LABEL);
      expect(event.prNumber).toBe(PR_NUMBER);
      expect(event.prUrl).toBe(PR_URL);
      expect(event.fixCyclesUsed).toBe(0);
      expect(event.auditVerdicts).toHaveLength(2);

      // CompletionRecord persisted with merge outcome
      const record = await completionRecordRepository.findByMilestoneId(MILESTONE_ID);
      expect(record.ok).toBe(true);
      if (record.ok && record.data) {
        expect(record.data.isMerged).toBe(true);
      }
    });
  });

  describe("guard: open slices remaining", () => {
    it("returns err(openSlicesRemaining)", async () => {
      resetIdCounter();
      const milestoneQueryPort = new StubMilestoneQueryPort().withSliceStatuses(
        ok([
          { sliceId: "s1", sliceLabel: "M05-S01", status: "closed" },
          { sliceId: "s2", sliceLabel: "M05-S02", status: "in_progress" },
        ]),
      );

      const { useCase } = buildUseCase({ milestoneQueryPort });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CompleteMilestoneError);
        expect(result.error.code).toBe("MILESTONE.OPEN_SLICES_REMAINING");
      }
    });
  });

  describe("guard: milestone not in_progress", () => {
    it("returns err(invalidMilestoneStatus)", async () => {
      resetIdCounter();
      const milestoneQueryPort = new StubMilestoneQueryPort().withMilestoneStatus(ok("completed"));

      const { useCase } = buildUseCase({ milestoneQueryPort });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CompleteMilestoneError);
        expect(result.error.code).toBe("MILESTONE.INVALID_STATUS");
      }
    });
  });

  describe("audit gate: no passing audit record", () => {
    it("returns err(auditRequired) when no audit record exists", async () => {
      resetIdCounter();
      const auditRecordRepo = new StubAuditRecordRepo();
      auditRecordRepo.record = null;

      const { useCase } = buildUseCase({ auditRecordRepo });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CompleteMilestoneError);
        expect(result.error.code).toBe("MILESTONE.AUDIT_REQUIRED");
      }
    });
  });

  describe("PR creation failure", () => {
    it("returns err(prCreationFailed)", async () => {
      resetIdCounter();
      const gitHubPort = makeStubGitHubPort({
        createResult: err(new Error("network error")),
      });

      const { useCase } = buildUseCase({ gitHubPort });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CompleteMilestoneError);
        expect(result.error.code).toBe("MILESTONE.PR_CREATION_FAILED");
      }
    });
  });

  describe("idempotent PR: existing open PR reused", () => {
    it("reuses existing PR, does NOT call createPullRequest", async () => {
      resetIdCounter();
      const gitHubPort = makeStubGitHubPort({
        listResult: ok([STUB_PR_INFO]),
      });
      const mergeGate = new StubMergeGatePort().withDecisions("merged");

      const { useCase } = buildUseCase({ gitHubPort, mergeGatePort: mergeGate });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.prNumber).toBe(PR_NUMBER);
        expect(result.data.prUrl).toBe(PR_URL);
      }

      const createFn = gitHubPort.createPullRequest as ReturnType<typeof vi.fn>;
      expect(createFn).not.toHaveBeenCalled();
    });
  });

  describe("merge declined (abort)", () => {
    it("returns err(mergeDeclined) and records abort outcome", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("abort");
      const { useCase, completionRecordRepository } = buildUseCase({
        mergeGatePort: mergeGate,
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CompleteMilestoneError);
        expect(result.error.code).toBe("MILESTONE.MERGE_DECLINED");
      }

      const record = await completionRecordRepository.findByMilestoneId(MILESTONE_ID);
      expect(record.ok).toBe(true);
      if (record.ok && record.data) {
        expect(record.data.isAborted).toBe(true);
      }
    });
  });

  describe("needs changes: one fix cycle then merged", () => {
    it("runs push in fix cycle, then merged on second ask", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("needs_changes", "merged");

      const { useCase, gitPort } = buildUseCase({
        mergeGatePort: mergeGate,
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.fixCyclesUsed).toBe(1);
        expect(result.data.merged).toBe(true);
      }

      // Push was called during fix cycle
      const pushFn = gitPort.pushFrom as ReturnType<typeof vi.fn>;
      expect(pushFn).toHaveBeenCalled();
    });
  });

  describe("max fix cycles exhausted: forced re-ask after max, then merged", () => {
    it("asks merge gate one more time after cycles exhausted", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions(
        "needs_changes", // cycle 0 — fix
        "needs_changes", // cycle 1 — fix
        "needs_changes", // cycle 2 — exhausted, no fix, re-ask
        "merged", // forced decide
      );

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
      });

      const result = await useCase.execute(makeRequest({ maxFixCycles: 2 }));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.fixCyclesUsed).toBe(3);
        expect(result.data.merged).toBe(true);
      }

      // Merge gate asked 4 times total
      expect(mergeGate.askCalls).toHaveLength(4);
    });
  });

  describe("cleanup failure: branch delete fails -> logged as warning, does not fail", () => {
    it("logs warning and proceeds to success", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("merged");
      const gitPort = makeStubGitPort({
        deleteBranchResult: err(new GitError("DELETE_FAILED", "branch locked")),
      });

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
        gitPort,
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.merged).toBe(true);
      }
    });
  });

  describe("milestone transition failure", () => {
    it("returns err(cleanupFailed)", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("merged");
      const milestoneTransitionPort = new StubMilestoneTransitionPort().withResult(
        err(MilestoneTransitionError.invalidTransition(MILESTONE_ID, "completed")),
      );

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
        milestoneTransitionPort,
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CompleteMilestoneError);
        expect(result.error.code).toBe("MILESTONE.CLEANUP_FAILED");
      }
    });
  });

  describe("diff size guard: truncateDiff utility", () => {
    it("truncates diffs exceeding the size limit", () => {
      const largeDiff = "x".repeat(DIFF_SIZE_LIMIT + 5000);
      const truncated = truncateDiff(largeDiff);
      expect(truncated.length).toBe(
        DIFF_SIZE_LIMIT + "\n\n[... diff truncated at 100KB ...]".length,
      );
      expect(truncated).toContain("[... diff truncated at 100KB ...]");
    });

    it("appends truncation notice even for small diffs", () => {
      const smallDiff = "x".repeat(100);
      const result = truncateDiff(smallDiff);
      expect(result).toContain(smallDiff);
      expect(result).toContain("[... diff truncated at 100KB ...]");
    });
  });

  describe("completion record persistence: save called after PR and after outcome", () => {
    it("persists the record at least twice", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("merged");
      const completionRecordRepository = new InMemoryCompletionRecordRepository();
      const saveSpy = vi.spyOn(completionRecordRepository, "save");

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
        completionRecordRepository,
      });

      await useCase.execute(makeRequest());

      // save called at least twice: once after creation, once after recordMerge
      expect(saveSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

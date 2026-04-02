import { WorktreeError } from "@hexagons/execution/domain/errors/worktree.error";
import type { WorktreePort } from "@hexagons/execution/domain/ports/worktree.port";
import { SliceTransitionError } from "@hexagons/workflow/domain/errors/slice-transition.error";
import type { SliceTransitionPort } from "@hexagons/workflow/domain/ports/slice-transition.port";
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
import type { ConductReviewRequest, ConductReviewResult } from "../domain/conduct-review.schemas";
import { FixerError } from "../domain/errors/fixer.error";
import { SliceSpecError } from "../domain/errors/review-context.error";
import { ShipError } from "../domain/errors/ship.error";
import { SliceShippedEvent } from "../domain/events/slice-shipped.event";
import type { FixRequest, FixResult } from "../domain/ports/fixer.port";
import { FixerPort } from "../domain/ports/fixer.port";
import type { MergeGateContext } from "../domain/ports/merge-gate.port";
import { MergeGatePort } from "../domain/ports/merge-gate.port";
import { type SliceSpec, SliceSpecPort } from "../domain/ports/slice-spec.port";
import type { MergeGateDecision } from "../domain/ship.schemas";
import { InMemoryShipRecordRepository } from "../infrastructure/in-memory-ship-record.repository";
import { ShipSliceUseCase } from "./ship-slice.use-case";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SLICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const WORKING_DIR = "/tmp/worktree";
const HEAD_BRANCH = "milestone/M05-S09";
const BASE_BRANCH = "milestone/M05";
const PR_URL = "https://github.com/org/repo/pull/42";
const PR_NUMBER = 42;

const STUB_SPEC: SliceSpec = {
  sliceId: SLICE_ID,
  sliceLabel: "M05-S09",
  sliceTitle: "Ship command",
  specContent: "Ship slice to main branch.\n\nDetailed spec content.",
  acceptanceCriteria: "- AC1: PR created\n- AC2: Merged successfully",
};

const STUB_PR_INFO: PullRequestInfo = {
  number: PR_NUMBER,
  title: "[M05-S09] Ship command",
  url: PR_URL,
  state: "open",
  head: HEAD_BRANCH,
  base: BASE_BRANCH,
  createdAt: new Date("2026-04-01T12:00:00.000Z"),
};

const FIXED_DATE = new Date("2026-04-01T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Stub ports
// ---------------------------------------------------------------------------
class StubSliceSpecPort extends SliceSpecPort {
  constructor(private result: Awaited<ReturnType<SliceSpecPort["getSpec"]>>) {
    super();
  }
  async getSpec(): Promise<Awaited<ReturnType<SliceSpecPort["getSpec"]>>> {
    return this.result;
  }
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

class StubFixerPort extends FixerPort {
  readonly fixCalls: FixRequest[] = [];
  private _results: Array<Result<FixResult, FixerError>> = [];
  private _callIndex = 0;

  withResult(result: Result<FixResult, FixerError>): this {
    this._results.push(result);
    return this;
  }

  async fix(request: FixRequest): Promise<Result<FixResult, FixerError>> {
    this.fixCalls.push(request);
    const idx = this._callIndex++;
    if (idx < this._results.length) {
      return this._results[idx];
    }
    return ok({
      fixed: [...request.findings],
      deferred: [],
      justifications: {},
      testsPassing: true,
    });
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

function makeConductReviewResult(findingCount: number): Result<ConductReviewResult, unknown> {
  const findings = Array.from({ length: findingCount }, (_, i) => ({
    id: `f${i + 1}`,
    severity: "medium" as const,
    message: `Finding ${i + 1}`,
    filePath: `src/file${i + 1}.ts`,
    lineStart: 10 + i,
    sourceReviewIds: [`review-${i + 1}`],
  }));

  return ok({
    mergedReview: {
      sliceId: SLICE_ID,
      sourceReviewIds: ["review-1"],
      verdict: findingCount > 0 ? "changes_requested" : ("approved" as const),
      findings,
      conflicts: [],
      mergedAt: FIXED_DATE,
    },
    individualReviews: [],
    fixCyclesUsed: 0,
    timedOutReviewers: [],
    retriedReviewers: [],
  });
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

function makeStubGitPort(overrides?: { pushResult?: Result<void, GitError> }): GitPort {
  return {
    pushFrom: vi.fn().mockResolvedValue(overrides?.pushResult ?? ok(undefined)),
  } as unknown as GitPort;
}

function makeStubWorktreePort(overrides?: {
  deleteResult?: Result<void, WorktreeError>;
}): WorktreePort {
  return {
    delete: vi.fn().mockResolvedValue(overrides?.deleteResult ?? ok(undefined)),
  } as unknown as WorktreePort;
}

function makeStubSliceTransitionPort(overrides?: {
  transitionResult?: Result<void, SliceTransitionError>;
}): SliceTransitionPort {
  return {
    transition: vi.fn().mockResolvedValue(overrides?.transitionResult ?? ok(undefined)),
  } as unknown as SliceTransitionPort;
}

function makeStubConductReview(overrides?: {
  results?: Array<Result<ConductReviewResult, unknown>>;
}): { execute: ReturnType<typeof vi.fn>; calls: ConductReviewRequest[] } {
  const calls: ConductReviewRequest[] = [];
  const results = overrides?.results ?? [makeConductReviewResult(0)];
  let callIndex = 0;

  const execute = vi.fn().mockImplementation((request: ConductReviewRequest) => {
    calls.push(request);
    const idx = callIndex++;
    if (idx < results.length) {
      return Promise.resolve(results[idx]);
    }
    return Promise.resolve(makeConductReviewResult(0));
  });

  return { execute, calls };
}

interface BuildUseCaseOverrides {
  sliceSpecPort?: SliceSpecPort;
  gitHubPort?: GitHubPort;
  mergeGatePort?: StubMergeGatePort;
  shipRecordRepository?: InMemoryShipRecordRepository;
  conductReview?: { execute: ReturnType<typeof vi.fn> };
  fixerPort?: StubFixerPort;
  gitPort?: GitPort;
  worktreePort?: WorktreePort;
  sliceTransitionPort?: SliceTransitionPort;
  eventBus?: EventBusPort;
  dateProvider?: DateProviderPort;
  generateId?: () => string;
}

function buildUseCase(overrides: BuildUseCaseOverrides = {}): {
  useCase: ShipSliceUseCase;
  mergeGatePort: StubMergeGatePort;
  shipRecordRepository: InMemoryShipRecordRepository;
  fixerPort: StubFixerPort;
  gitHubPort: GitHubPort;
  gitPort: GitPort;
  worktreePort: WorktreePort;
  sliceTransitionPort: SliceTransitionPort;
  eventBus: SpyEventBus;
  conductReview: { execute: ReturnType<typeof vi.fn> };
} {
  const sliceSpecPort = overrides.sliceSpecPort ?? new StubSliceSpecPort(ok(STUB_SPEC));
  const gitHubPort = overrides.gitHubPort ?? makeStubGitHubPort();
  const mergeGatePort = overrides.mergeGatePort ?? new StubMergeGatePort();
  const shipRecordRepository = overrides.shipRecordRepository ?? new InMemoryShipRecordRepository();
  const conductReview = overrides.conductReview ?? makeStubConductReview();
  const fixerPort = overrides.fixerPort ?? new StubFixerPort();
  const gitPort = overrides.gitPort ?? makeStubGitPort();
  const worktreePort = overrides.worktreePort ?? makeStubWorktreePort();
  const sliceTransitionPort = overrides.sliceTransitionPort ?? makeStubSliceTransitionPort();
  const eventBus =
    overrides.eventBus instanceof SpyEventBus ? overrides.eventBus : new SpyEventBus(logger);
  const dateProvider = overrides.dateProvider ?? new FixedDateProvider();
  const generateId = overrides.generateId ?? deterministicId;

  const useCase = new ShipSliceUseCase(
    sliceSpecPort,
    gitHubPort,
    mergeGatePort,
    shipRecordRepository,
    conductReview,
    fixerPort,
    gitPort,
    worktreePort,
    sliceTransitionPort,
    eventBus,
    dateProvider,
    generateId,
    logger,
  );

  return {
    useCase,
    mergeGatePort,
    shipRecordRepository,
    fixerPort,
    gitHubPort,
    gitPort,
    worktreePort,
    sliceTransitionPort,
    eventBus,
    conductReview,
  };
}

function makeRequest(
  overrides?: Partial<{
    sliceId: string;
    workingDirectory: string;
    baseBranch: string;
    headBranch: string;
    maxFixCycles: number;
  }>,
): {
  sliceId: string;
  workingDirectory: string;
  baseBranch: string;
  headBranch: string;
  maxFixCycles: number;
} {
  return {
    sliceId: SLICE_ID,
    workingDirectory: WORKING_DIR,
    baseBranch: BASE_BRANCH,
    headBranch: HEAD_BRANCH,
    maxFixCycles: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ShipSliceUseCase", () => {
  describe("happy path: PR created, merged, cleanup, event emitted", () => {
    it("returns ok with merged=true and emits SliceShippedEvent", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("merged");
      const eventBus = new SpyEventBus(logger);

      const { useCase, shipRecordRepository } = buildUseCase({
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
        expect(result.data.sliceId).toBe(SLICE_ID);
      }

      // Event emitted
      const shippedEvents = eventBus.publishedEvents.filter((e) => e instanceof SliceShippedEvent);
      expect(shippedEvents).toHaveLength(1);
      const event = shippedEvents[0] as SliceShippedEvent;
      expect(event.sliceId).toBe(SLICE_ID);
      expect(event.prNumber).toBe(PR_NUMBER);
      expect(event.prUrl).toBe(PR_URL);
      expect(event.fixCyclesUsed).toBe(0);

      // Ship record persisted with merge outcome
      const records = await shipRecordRepository.findBySliceId(SLICE_ID);
      expect(records.ok).toBe(true);
      if (records.ok) {
        expect(records.data).toHaveLength(1);
        expect(records.data[0].isMerged).toBe(true);
      }
    });
  });

  describe("idempotent PR: existing PR found, createPullRequest NOT called", () => {
    it("reuses existing PR number and URL", async () => {
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

      // createPullRequest should NOT have been called
      const createFn = gitHubPort.createPullRequest as ReturnType<typeof vi.fn>;
      expect(createFn).not.toHaveBeenCalled();
    });
  });

  describe("context resolution failure: getSpec fails", () => {
    it("returns ShipError.contextResolutionFailed", async () => {
      resetIdCounter();
      const { useCase } = buildUseCase({
        sliceSpecPort: new StubSliceSpecPort(err(new SliceSpecError("spec not found"))),
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ShipError);
        expect(result.error.code).toBe("SHIP.CONTEXT_RESOLUTION_FAILED");
      }
    });
  });

  describe("PR creation failure", () => {
    it("returns ShipError.prCreationFailed", async () => {
      resetIdCounter();
      const gitHubPort = makeStubGitHubPort({
        createResult: err(new Error("network error")),
      });
      const { useCase } = buildUseCase({ gitHubPort });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ShipError);
        expect(result.error.code).toBe("SHIP.PR_CREATION_FAILED");
      }
    });
  });

  describe("abort: user says 'abort'", () => {
    it("returns ShipError.mergeDeclined and records abort outcome", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("abort");
      const { useCase, shipRecordRepository } = buildUseCase({
        mergeGatePort: mergeGate,
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ShipError);
        expect(result.error.code).toBe("SHIP.MERGE_DECLINED");
      }

      const records = await shipRecordRepository.findBySliceId(SLICE_ID);
      expect(records.ok).toBe(true);
      if (records.ok) {
        expect(records.data).toHaveLength(1);
        expect(records.data[0].isAborted).toBe(true);
      }
    });
  });

  describe("needs changes loop: review, fix, push, then merged", () => {
    it("runs one fix cycle then succeeds on merged", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("needs_changes", "merged");
      const conductReview = makeStubConductReview({
        results: [makeConductReviewResult(2)],
      });
      const fixerPort = new StubFixerPort();

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
        conductReview,
        fixerPort,
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.fixCyclesUsed).toBe(1);
        expect(result.data.merged).toBe(true);
      }

      // Fixer was called with findings
      expect(fixerPort.fixCalls).toHaveLength(1);
      expect(fixerPort.fixCalls[0].sliceId).toBe(SLICE_ID);
      expect(fixerPort.fixCalls[0].findings).toHaveLength(2);
    });
  });

  describe("max fix cycles: needs_changes repeated until exhausted, then forced decide", () => {
    it("asks merge gate one more time after cycles exhausted", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions(
        "needs_changes", // cycle 0 — fix
        "needs_changes", // cycle 1 — fix
        "needs_changes", // cycle 2 — exhausted, no fix, re-ask
        "merged", // forced decide
      );
      const conductReview = makeStubConductReview({
        results: [makeConductReviewResult(1), makeConductReviewResult(1)],
      });
      const fixerPort = new StubFixerPort();

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
        conductReview,
        fixerPort,
      });

      const result = await useCase.execute(makeRequest({ maxFixCycles: 2 }));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.fixCyclesUsed).toBe(3);
        expect(result.data.merged).toBe(true);
      }

      // Fixer called only during the 2 actual fix cycles (not the exhausted one)
      expect(fixerPort.fixCalls).toHaveLength(2);

      // Merge gate asked 4 times total
      expect(mergeGate.askCalls).toHaveLength(4);
    });
  });

  describe("fixer failure graceful: fixer throws, lastError set, merge gate re-asked", () => {
    it("captures fixer error and continues loop", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("needs_changes", "merged");
      const conductReview = makeStubConductReview({
        results: [makeConductReviewResult(2)],
      });
      const fixerPort = new StubFixerPort().withResult(err(new FixerError("Fixer exploded")));

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
        conductReview,
        fixerPort,
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.merged).toBe(true);
        expect(result.data.fixCyclesUsed).toBe(1);
      }

      // Merge gate second call should have lastError set
      expect(mergeGate.askCalls).toHaveLength(2);
      expect(mergeGate.askCalls[1].lastError).toBe("Fixer exploded");
    });
  });

  describe("push failure graceful: push fails, lastError set, loop continues", () => {
    it("captures push error and continues to next merge gate ask", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("needs_changes", "merged");
      const conductReview = makeStubConductReview({
        results: [makeConductReviewResult(0)],
      });
      const gitPort = makeStubGitPort({
        pushResult: err(new GitError("PUSH_FAILED", "push rejected")),
      });

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
        conductReview,
        gitPort,
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.merged).toBe(true);
      }

      // Merge gate second call should have lastError
      expect(mergeGate.askCalls[1].lastError).toBeDefined();
    });
  });

  describe("cleanup failure (worktree): delete fails, log warning, still returns merged=true", () => {
    it("logs warning and proceeds", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("merged");
      const worktreePort = makeStubWorktreePort({
        deleteResult: err(WorktreeError.deletionFailed(SLICE_ID, "disk full")),
      });

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
        worktreePort,
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.merged).toBe(true);
      }
    });
  });

  describe("transition failure: sliceTransition fails", () => {
    it("returns ShipError.cleanupFailed", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("merged");
      const sliceTransitionPort = makeStubSliceTransitionPort({
        transitionResult: err(new SliceTransitionError(SLICE_ID, "transition not allowed")),
      });

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
        sliceTransitionPort,
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ShipError);
        expect(result.error.code).toBe("SHIP.CLEANUP_FAILED");
      }
    });
  });

  describe("ship record persistence: save called after PR creation AND after outcome", () => {
    it("persists the record twice", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("merged");
      const shipRecordRepository = new InMemoryShipRecordRepository();
      const saveSpy = vi.spyOn(shipRecordRepository, "save");

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
        shipRecordRepository,
      });

      await useCase.execute(makeRequest());

      // save called at least twice: once after creation, once after recordMerge
      expect(saveSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("ConductReview args: verify maxFixCycles=0 and timeoutMs=120000", () => {
    it("passes correct args to conductReview.execute", async () => {
      resetIdCounter();
      const mergeGate = new StubMergeGatePort().withDecisions("needs_changes", "merged");
      const conductReview = makeStubConductReview({
        results: [makeConductReviewResult(0)],
      });

      const { useCase } = buildUseCase({
        mergeGatePort: mergeGate,
        conductReview,
      });

      await useCase.execute(makeRequest());

      expect(conductReview.execute).toHaveBeenCalledTimes(1);
      const callArg = conductReview.calls[0];
      expect(callArg.maxFixCycles).toBe(0);
      expect(callArg.timeoutMs).toBe(120_000);
      expect(callArg.sliceId).toBe(SLICE_ID);
      expect(callArg.workingDirectory).toBe(WORKING_DIR);
    });
  });
});

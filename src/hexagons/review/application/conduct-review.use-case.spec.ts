import { InMemoryAgentDispatchAdapter } from "@hexagons/execution";
import {
  type DomainEvent,
  err,
  InProcessEventBus,
  type ModelProfileName,
  ok,
  type Result,
  SilentLoggerAdapter,
  SystemDateProvider,
} from "@kernel";
import {
  type AgentDispatchConfig,
  AgentDispatchError,
  AgentDispatchPort,
  type AgentResult,
  AgentResultBuilder,
  type ResolvedModel,
} from "@kernel/agents";
import type { DateProviderPort, EventBusPort } from "@kernel/ports";
import { describe, expect, it } from "vitest";
import type { ConductReviewRequest } from "../domain/conduct-review.schemas";
import { ConductReviewError } from "../domain/errors/conduct-review.error";
import { ExecutorQueryError } from "../domain/errors/executor-query.error";
import { FixerError } from "../domain/errors/fixer.error";
import { ChangedFilesError, SliceSpecError } from "../domain/errors/review-context.error";
import { ReviewPipelineCompletedEvent } from "../domain/events/review-pipeline-completed.event";
import { ChangedFilesPort } from "../domain/ports/changed-files.port";
import { ExecutorQueryPort } from "../domain/ports/executor-query.port";
import { FixerPort, type FixRequest, type FixResult } from "../domain/ports/fixer.port";
import { type SliceSpec, SliceSpecPort } from "../domain/ports/slice-spec.port";
import type { FindingProps } from "../domain/review.schemas";
import { CritiqueReflectionService } from "../domain/services/critique-reflection.service";
import { FreshReviewerService } from "../domain/services/fresh-reviewer.service";
import { InMemoryReviewRepository } from "../infrastructure/in-memory-review.repository";
import { ConductReviewUseCase } from "./conduct-review.use-case";
import { ReviewPromptBuilder } from "./review-prompt-builder";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SLICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const WORKING_DIR = "/tmp/worktree";

const STUB_SPEC: SliceSpec = {
  sliceId: SLICE_ID,
  sliceLabel: "M05-S04",
  sliceTitle: "Multi-stage review pipeline",
  specContent: "Review pipeline spec content",
  acceptanceCriteria: "- AC1: pass\n- AC2: pass",
};

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

class StubChangedFilesPort extends ChangedFilesPort {
  constructor(private result: Awaited<ReturnType<ChangedFilesPort["getDiff"]>>) {
    super();
  }
  async getDiff(): Promise<Awaited<ReturnType<ChangedFilesPort["getDiff"]>>> {
    return this.result;
  }
}

class StubExecutorQueryPort extends ExecutorQueryPort {
  async getSliceExecutors(): Promise<Result<ReadonlySet<string>, never>> {
    return ok(new Set<string>());
  }
}

/** Returns executors that always include the queried identity (for violation tests). */
class ViolatingExecutorQueryPort extends ExecutorQueryPort {
  private _queriedSliceIds: string[] = [];

  async getSliceExecutors(
    sliceId: string,
  ): Promise<Result<ReadonlySet<string>, ExecutorQueryError>> {
    this._queriedSliceIds.push(sliceId);
    // Return a set containing ALL possible reviewer identities (catch-all)
    // The fresh-reviewer service matches the exact identity, so we use a wildcard approach:
    // We return a set that .has() returns true for any string
    return ok(new MatchAllSet());
  }

  get queriedSliceIds(): readonly string[] {
    return this._queriedSliceIds;
  }
}

/** A set that matches all strings — used to trigger fresh-reviewer violation. */
class MatchAllSet extends Set<string> {
  override has(_value: string): boolean {
    return true;
  }
}

/** ExecutorQueryPort that always returns an error. */
class FailingExecutorQueryPort extends ExecutorQueryPort {
  async getSliceExecutors(): Promise<Result<ReadonlySet<string>, ExecutorQueryError>> {
    return err(new ExecutorQueryError("Database connection failed"));
  }
}

/** Tracks enforce calls on FreshReviewerService. */
class TrackingFreshReviewerService extends FreshReviewerService {
  readonly enforceCalls: Array<{ sliceId: string; reviewerId: string }> = [];

  override async enforce(
    sliceId: string,
    reviewerId: string,
  ): ReturnType<FreshReviewerService["enforce"]> {
    this.enforceCalls.push({ sliceId, reviewerId });
    return super.enforce(sliceId, reviewerId);
  }
}

class StubFixerPort extends FixerPort {
  async fix(): Promise<never> {
    throw new Error("StubFixerPort.fix not expected in T08");
  }
}

/** Fixer that defers all findings (simulates "fixed nothing"). */
class DeferAllFixerPort extends FixerPort {
  readonly fixCalls: Array<{ sliceId: string; findings: FindingProps[] }> = [];

  async fix(request: FixRequest): Promise<Result<FixResult, FixerError>> {
    this.fixCalls.push({ sliceId: request.sliceId, findings: [...request.findings] });
    return ok({ fixed: [], deferred: [...request.findings], testsPassing: true });
  }
}

/** Fixer that always returns an error. */
class FailingFixerPort extends FixerPort {
  async fix(): Promise<Result<FixResult, FixerError>> {
    return err(new FixerError("Fixer exploded"));
  }
}

/** EventBus that captures all published events. */
class SpyEventBus extends InProcessEventBus {
  readonly publishedEvents: DomainEvent[] = [];

  override async publish(event: DomainEvent): Promise<void> {
    this.publishedEvents.push(event);
    return super.publish(event);
  }
}

class FailingDispatchAdapter extends AgentDispatchPort {
  private _dispatched: AgentDispatchConfig[] = [];

  async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
    this._dispatched.push(config);
    return err(AgentDispatchError.unexpectedFailure(config.taskId, "simulated failure"));
  }

  async abort(): Promise<void> {
    /* no-op */
  }

  isRunning(): boolean {
    return false;
  }

  get dispatchedConfigs(): readonly AgentDispatchConfig[] {
    return this._dispatched;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const logger = new SilentLoggerAdapter();

const FIXED_DATE = new Date("2026-04-01T12:00:00.000Z");

class FixedDateProvider implements DateProviderPort {
  now(): Date {
    return FIXED_DATE;
  }
}

function makeRequest(overrides?: Partial<ConductReviewRequest>): ConductReviewRequest {
  return {
    sliceId: SLICE_ID,
    workingDirectory: WORKING_DIR,
    timeoutMs: 300_000,
    maxFixCycles: 2,
    ...overrides,
  };
}

function stubModelResolver(_profile: ModelProfileName): ResolvedModel {
  return { provider: "anthropic", modelId: "claude-sonnet-4-6" };
}

function stubTemplateLoader(_path: string): string {
  return "Review {{sliceLabel}} {{sliceTitle}} {{sliceId}} {{reviewRole}} {{changedFiles}} {{acceptanceCriteria}}";
}

function makeFinding(overrides?: Partial<FindingProps>): FindingProps {
  return {
    id: crypto.randomUUID(),
    severity: "medium",
    message: "Test finding",
    filePath: "src/foo.ts",
    lineStart: 42,
    ...overrides,
  };
}

function makeCtrOutput(findings: FindingProps[]): string {
  return JSON.stringify({
    critique: {
      rawFindings: findings,
    },
    reflection: {
      prioritizedFindings: findings.map((f) => ({ ...f, impact: "should-fix" })),
      insights: [],
      summary: "Test summary",
    },
  });
}

function makeStandardOutput(findings: FindingProps[]): string {
  return JSON.stringify(findings);
}

interface BuildUseCaseOverrides {
  sliceSpecPort?: SliceSpecPort;
  changedFilesPort?: ChangedFilesPort;
  agentDispatchPort?: AgentDispatchPort;
  executorQueryPort?: ExecutorQueryPort;
  freshReviewerService?: FreshReviewerService;
  fixerPort?: FixerPort;
  reviewRepository?: InMemoryReviewRepository;
  eventBus?: EventBusPort;
  dateProvider?: DateProviderPort;
}

function buildUseCase(overrides: BuildUseCaseOverrides = {}): ConductReviewUseCase {
  const sliceSpecPort = overrides.sliceSpecPort ?? new StubSliceSpecPort(ok(STUB_SPEC));
  const changedFilesPort =
    overrides.changedFilesPort ?? new StubChangedFilesPort(ok("diff --git a/foo.ts b/foo.ts"));
  const executorQueryPort = overrides.executorQueryPort ?? new StubExecutorQueryPort();
  const freshReviewerService =
    overrides.freshReviewerService ?? new FreshReviewerService(executorQueryPort);
  const critiqueReflectionService = new CritiqueReflectionService();
  const promptBuilder = new ReviewPromptBuilder(stubTemplateLoader);
  const fixerPort = overrides.fixerPort ?? new StubFixerPort();
  const reviewRepository = overrides.reviewRepository ?? new InMemoryReviewRepository();
  const eventBus = overrides.eventBus ?? new InProcessEventBus(logger);
  const dateProvider = overrides.dateProvider ?? new SystemDateProvider();
  const agentDispatchPort = overrides.agentDispatchPort ?? new InMemoryAgentDispatchAdapter();

  return new ConductReviewUseCase(
    sliceSpecPort,
    changedFilesPort,
    freshReviewerService,
    agentDispatchPort,
    critiqueReflectionService,
    promptBuilder,
    stubModelResolver,
    fixerPort,
    reviewRepository,
    eventBus,
    dateProvider,
    logger,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ConductReviewUseCase", () => {
  describe("parallel dispatch (AC1)", () => {
    it("dispatches 3 reviewers in parallel via Promise.allSettled", async () => {
      const dispatch = new InMemoryAgentDispatchAdapter();
      const useCase = buildUseCase({ agentDispatchPort: dispatch });

      await useCase.execute(makeRequest());

      expect(dispatch.dispatchedConfigs).toHaveLength(3);
      const agentTypes = dispatch.dispatchedConfigs.map((c) => c.agentType);
      expect(agentTypes).toContain("code-reviewer");
      expect(agentTypes).toContain("spec-reviewer");
      expect(agentTypes).toContain("security-auditor");
    });
  });

  describe("distinct agentIdentity (AC5)", () => {
    it("each reviewer gets a distinct agentType and unique taskId", async () => {
      const dispatch = new InMemoryAgentDispatchAdapter();
      const useCase = buildUseCase({ agentDispatchPort: dispatch });

      await useCase.execute(makeRequest());

      const taskIds = dispatch.dispatchedConfigs.map((c) => c.taskId);
      const uniqueTaskIds = new Set(taskIds);
      expect(uniqueTaskIds.size).toBe(3);

      const agentTypes = new Set(dispatch.dispatchedConfigs.map((c) => c.agentType));
      expect(agentTypes.size).toBe(3);
    });
  });

  describe("context resolution (AC24)", () => {
    it("returns contextResolutionFailed when sliceSpecPort fails", async () => {
      const useCase = buildUseCase({
        sliceSpecPort: new StubSliceSpecPort(err(new SliceSpecError("spec not found"))),
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ConductReviewError);
        expect(result.error.code).toBe("REVIEW.CONTEXT_RESOLUTION_FAILED");
      }
    });

    it("returns contextResolutionFailed when changedFilesPort fails", async () => {
      const useCase = buildUseCase({
        changedFilesPort: new StubChangedFilesPort(err(new ChangedFilesError("git diff failed"))),
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ConductReviewError);
        expect(result.error.code).toBe("REVIEW.CONTEXT_RESOLUTION_FAILED");
      }
    });
  });

  describe("timeout + abort (AC2)", () => {
    it("aborts dispatch after timeoutMs and retries once", async () => {
      const slowDispatch = new SlowDispatchAdapter(200);
      const useCase = buildUseCase({ agentDispatchPort: slowDispatch });

      const result = await useCase.execute(makeRequest({ timeoutMs: 50 }));

      // All 3 timed out on first attempt, then retried and timed out again → allReviewersFailed
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("REVIEW.ALL_REVIEWERS_FAILED");
      }
      // 3 initial + 3 retries = 6 dispatches
      expect(slowDispatch.dispatchCount).toBe(6);
      // All 3 should have been aborted at least once
      expect(slowDispatch.abortCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("retry (AC3)", () => {
    it("retries failed reviewer exactly once then returns reviewerRetryExhausted", async () => {
      const partialFailDispatch = new PartialFailDispatchAdapter(["security-auditor"]);
      const useCase = buildUseCase({ agentDispatchPort: partialFailDispatch });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("REVIEW.REVIEWER_RETRY_EXHAUSTED");
      }
      // security-auditor dispatched twice (initial + 1 retry)
      const securityDispatches = partialFailDispatch.dispatchedConfigs.filter(
        (c) => c.agentType === "security-auditor",
      );
      expect(securityDispatches).toHaveLength(2);
    });
  });

  describe("all reviewers fail (AC4)", () => {
    it("returns allReviewersFailed when all 3 fail after retry", async () => {
      const dispatch = new FailingDispatchAdapter();
      const useCase = buildUseCase({ agentDispatchPort: dispatch });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ConductReviewError);
        expect(result.error.code).toBe("REVIEW.ALL_REVIEWERS_FAILED");
      }
      // 3 initial + 3 retries = 6 dispatches total
      expect(dispatch.dispatchedConfigs).toHaveLength(6);
    });
  });

  describe("dispatch config correctness", () => {
    it("passes correct sliceId and workingDirectory to dispatch configs", async () => {
      const dispatch = new InMemoryAgentDispatchAdapter();
      const useCase = buildUseCase({ agentDispatchPort: dispatch });

      await useCase.execute(makeRequest());

      for (const config of dispatch.dispatchedConfigs) {
        expect(config.sliceId).toBe(SLICE_ID);
        expect(config.workingDirectory).toBe(WORKING_DIR);
      }
    });

    it("includes required tools from agent registry", async () => {
      const dispatch = new InMemoryAgentDispatchAdapter();
      const useCase = buildUseCase({ agentDispatchPort: dispatch });

      await useCase.execute(makeRequest());

      for (const config of dispatch.dispatchedConfigs) {
        expect(config.tools).toEqual(expect.arrayContaining(["Read", "Glob", "Grep"]));
      }
    });

    it("includes resolved model in dispatch config", async () => {
      const dispatch = new InMemoryAgentDispatchAdapter();
      const useCase = buildUseCase({ agentDispatchPort: dispatch });

      await useCase.execute(makeRequest());

      for (const config of dispatch.dispatchedConfigs) {
        expect(config.model).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
      }
    });
  });

  // =========================================================================
  // T09 — fresh-reviewer + CTR + merge + persist
  // =========================================================================
  describe("fresh-reviewer enforcement (AC6)", () => {
    it("calls FreshReviewerService.enforce() for each reviewer before dispatch", async () => {
      const tracking = new TrackingFreshReviewerService(new StubExecutorQueryPort());
      const useCase = buildUseCase({ freshReviewerService: tracking });

      await useCase.execute(makeRequest());

      expect(tracking.enforceCalls).toHaveLength(3);
      const sliceIds = tracking.enforceCalls.map((c) => c.sliceId);
      expect(sliceIds.every((id) => id === SLICE_ID)).toBe(true);
      // Each reviewer ID should be unique
      const reviewerIds = new Set(tracking.enforceCalls.map((c) => c.reviewerId));
      expect(reviewerIds.size).toBe(3);
    });
  });

  describe("fresh-reviewer violation → freshReviewerBlocked (AC7)", () => {
    it("returns freshReviewerBlocked when executor set contains reviewer identity", async () => {
      const executorQueryPort = new ViolatingExecutorQueryPort();
      const freshReviewerService = new FreshReviewerService(executorQueryPort);
      const useCase = buildUseCase({ executorQueryPort, freshReviewerService });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ConductReviewError);
        expect(result.error.code).toBe("REVIEW.FRESH_REVIEWER_BLOCKED");
      }
    });
  });

  describe("ExecutorQueryError from enforce → contextResolutionFailed (fail-closed)", () => {
    it("returns contextResolutionFailed when executor query errors", async () => {
      const executorQueryPort = new FailingExecutorQueryPort();
      const freshReviewerService = new FreshReviewerService(executorQueryPort);
      const useCase = buildUseCase({ executorQueryPort, freshReviewerService });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ConductReviewError);
        expect(result.error.code).toBe("REVIEW.CONTEXT_RESOLUTION_FAILED");
      }
    });
  });

  describe("CTR roles processed via CritiqueReflectionService (AC8)", () => {
    it("extracts findings from CTR output for code-reviewer and security-auditor", async () => {
      const finding1 = makeFinding({ message: "CTR finding 1" });
      const finding2 = makeFinding({ message: "CTR finding 2" });

      const dispatch = new OutputDispatchAdapter({
        "code-reviewer": makeCtrOutput([finding1]),
        "security-auditor": makeCtrOutput([finding2]),
        "spec-reviewer": makeStandardOutput([]),
      });

      const reviewRepository = new InMemoryReviewRepository();
      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        reviewRepository,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        const codeReview = result.data.individualReviews.find((r) => r.role === "code-reviewer");
        const securityReview = result.data.individualReviews.find(
          (r) => r.role === "security-auditor",
        );
        expect(codeReview?.findings).toHaveLength(1);
        expect(codeReview?.findings[0].message).toBe("CTR finding 1");
        expect(securityReview?.findings).toHaveLength(1);
        expect(securityReview?.findings[0].message).toBe("CTR finding 2");
      }
    });
  });

  describe("spec-reviewer NOT processed via CTR (AC9)", () => {
    it("parses spec-reviewer findings directly, not through CritiqueReflectionService", async () => {
      const specFinding = makeFinding({ message: "Spec finding" });

      const dispatch = new OutputDispatchAdapter({
        "code-reviewer": makeCtrOutput([]),
        "security-auditor": makeCtrOutput([]),
        "spec-reviewer": makeStandardOutput([specFinding]),
      });

      const reviewRepository = new InMemoryReviewRepository();
      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        reviewRepository,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        const specReview = result.data.individualReviews.find((r) => r.role === "spec-reviewer");
        expect(specReview?.findings).toHaveLength(1);
        expect(specReview?.findings[0].message).toBe("Spec finding");
      }
    });
  });

  describe("3 Reviews created and saved (AC10)", () => {
    it("creates and persists 3 Review aggregates via reviewRepository.save()", async () => {
      const dispatch = new OutputDispatchAdapter({
        "code-reviewer": makeCtrOutput([]),
        "security-auditor": makeCtrOutput([]),
        "spec-reviewer": makeStandardOutput([]),
      });

      const reviewRepository = new InMemoryReviewRepository();
      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        reviewRepository,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);

      const savedResult = await reviewRepository.findBySliceId(SLICE_ID);
      expect(savedResult.ok).toBe(true);
      if (savedResult.ok) {
        expect(savedResult.data).toHaveLength(3);
        const roles = savedResult.data.map((r) => r.role).sort();
        expect(roles).toEqual(["code-reviewer", "security-auditor", "spec-reviewer"]);
      }
    });
  });

  describe("MergedReview.merge() invoked (AC11)", () => {
    it("returns mergedReview with correct sourceReviewIds", async () => {
      const dispatch = new OutputDispatchAdapter({
        "code-reviewer": makeCtrOutput([]),
        "security-auditor": makeCtrOutput([]),
        "spec-reviewer": makeStandardOutput([]),
      });

      const reviewRepository = new InMemoryReviewRepository();
      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        reviewRepository,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mergedReview.sourceReviewIds).toHaveLength(3);
        expect(result.data.mergedReview.sliceId).toBe(SLICE_ID);
        // Each sourceReviewId should match an individual review id
        const individualIds = result.data.individualReviews.map((r) => r.id);
        for (const sourceId of result.data.mergedReview.sourceReviewIds) {
          expect(individualIds).toContain(sourceId);
        }
      }
    });
  });

  describe("CTR parse error → degraded 0 findings (AC25)", () => {
    it("degrades to 0 findings when CTR output is invalid JSON", async () => {
      const dispatch = new OutputDispatchAdapter({
        "code-reviewer": "not valid json at all",
        "security-auditor": makeCtrOutput([]),
        "spec-reviewer": makeStandardOutput([]),
      });

      const reviewRepository = new InMemoryReviewRepository();
      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        reviewRepository,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        const codeReview = result.data.individualReviews.find((r) => r.role === "code-reviewer");
        expect(codeReview?.findings).toHaveLength(0);
      }
    });

    it("degrades to 0 findings when CTR output fails schema validation", async () => {
      // Valid JSON but doesn't match CTR schema
      const dispatch = new OutputDispatchAdapter({
        "code-reviewer": JSON.stringify({ bad: "structure" }),
        "security-auditor": makeCtrOutput([]),
        "spec-reviewer": makeStandardOutput([]),
      });

      const reviewRepository = new InMemoryReviewRepository();
      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        reviewRepository,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        const codeReview = result.data.individualReviews.find((r) => r.role === "code-reviewer");
        expect(codeReview?.findings).toHaveLength(0);
      }
    });
  });

  // =========================================================================
  // T10 — fixer loop + event emission + error paths
  // =========================================================================
  describe("fixerPort.fix() invoked when merged.hasBlockers() (AC14)", () => {
    it("calls fixer when review findings include critical/high severity", async () => {
      const blockerFinding = makeFinding({ severity: "critical", message: "Critical bug" });

      // All reviewers return a critical finding → merged has blockers
      const dispatch = new OutputDispatchAdapter({
        "code-reviewer": makeCtrOutput([blockerFinding]),
        "security-auditor": makeCtrOutput([]),
        "spec-reviewer": makeStandardOutput([]),
      });

      const fixerPort = new DeferAllFixerPort();
      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        fixerPort,
        dateProvider: new FixedDateProvider(),
      });

      await useCase.execute(makeRequest({ maxFixCycles: 1 }));

      expect(fixerPort.fixCalls).toHaveLength(1);
      expect(fixerPort.fixCalls[0].sliceId).toBe(SLICE_ID);
      expect(fixerPort.fixCalls[0].findings.length).toBeGreaterThan(0);
    });
  });

  describe("fixer loop terminates after maxFixCycles (AC15)", () => {
    it("stops after exactly maxFixCycles iterations with fixCyclesUsed = maxFixCycles", async () => {
      const blockerFinding = makeFinding({ severity: "critical", message: "Persistent blocker" });

      // Every cycle returns blockers (fixer never resolves them)
      const dispatch = new CycleAwareDispatchAdapter([
        // Cycle 0 (initial): blockers
        {
          "code-reviewer": makeCtrOutput([blockerFinding]),
          "security-auditor": makeCtrOutput([]),
          "spec-reviewer": makeStandardOutput([]),
        },
        // Cycle 1 (re-review after fix 1): still blockers
        {
          "code-reviewer": makeCtrOutput([blockerFinding]),
          "security-auditor": makeCtrOutput([]),
          "spec-reviewer": makeStandardOutput([]),
        },
        // Cycle 2 (re-review after fix 2): still blockers
        {
          "code-reviewer": makeCtrOutput([blockerFinding]),
          "security-auditor": makeCtrOutput([]),
          "spec-reviewer": makeStandardOutput([]),
        },
      ]);

      const fixerPort = new DeferAllFixerPort();
      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        fixerPort,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute(makeRequest({ maxFixCycles: 2 }));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.fixCyclesUsed).toBe(2);
      }
      expect(fixerPort.fixCalls).toHaveLength(2);
    });
  });

  describe("after fix, all 3 reviewers re-dispatched (AC16)", () => {
    it("dispatches 6 total times (3 initial + 3 re-review) when fix resolves blockers", async () => {
      const blockerFinding = makeFinding({ severity: "high", message: "High sev bug" });

      // Cycle 0: blockers; Cycle 1: no blockers
      const dispatch = new CycleAwareDispatchAdapter([
        {
          "code-reviewer": makeCtrOutput([blockerFinding]),
          "security-auditor": makeCtrOutput([]),
          "spec-reviewer": makeStandardOutput([]),
        },
        {
          "code-reviewer": makeCtrOutput([]),
          "security-auditor": makeCtrOutput([]),
          "spec-reviewer": makeStandardOutput([]),
        },
      ]);

      const fixerPort = new DeferAllFixerPort();
      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        fixerPort,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute(makeRequest({ maxFixCycles: 2 }));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.fixCyclesUsed).toBe(1);
      }
      // 3 initial + 3 re-review = 6
      expect(dispatch.dispatchedConfigs).toHaveLength(6);
    });
  });

  describe("fixer failure → loop stops, current result returned (AC26)", () => {
    it("returns ok result (not error) with fixCyclesUsed=0 when fixer fails", async () => {
      const blockerFinding = makeFinding({ severity: "critical", message: "Critical bug" });

      const dispatch = new OutputDispatchAdapter({
        "code-reviewer": makeCtrOutput([blockerFinding]),
        "security-auditor": makeCtrOutput([]),
        "spec-reviewer": makeStandardOutput([]),
      });

      const failingFixer = new FailingFixerPort();
      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        fixerPort: failingFixer,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute(makeRequest({ maxFixCycles: 2 }));

      // Graceful: ok result, not error
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.fixCyclesUsed).toBe(0);
        // Still has the merged review from initial dispatch
        expect(result.data.mergedReview).toBeDefined();
      }
    });
  });

  describe("ReviewPipelineCompletedEvent emitted with all fields (AC23)", () => {
    it("emits ReviewPipelineCompletedEvent after pipeline completes", async () => {
      const finding = makeFinding({ severity: "medium", message: "Advisory" });

      const dispatch = new OutputDispatchAdapter({
        "code-reviewer": makeCtrOutput([finding]),
        "security-auditor": makeCtrOutput([]),
        "spec-reviewer": makeStandardOutput([]),
      });

      const eventBus = new SpyEventBus(logger);
      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        eventBus,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute(makeRequest());

      expect(result.ok).toBe(true);

      const pipelineEvents = eventBus.publishedEvents.filter(
        (e) => e instanceof ReviewPipelineCompletedEvent,
      );
      expect(pipelineEvents).toHaveLength(1);

      const event = pipelineEvents[0] as ReviewPipelineCompletedEvent;
      expect(event.sliceId).toBe(SLICE_ID);
      expect(event.verdict).toBeDefined();
      expect(event.reviewCount).toBeGreaterThanOrEqual(3);
      expect(typeof event.findingsCount).toBe("number");
      expect(typeof event.blockerCount).toBe("number");
      expect(typeof event.conflictCount).toBe("number");
      expect(typeof event.fixCyclesUsed).toBe("number");
      expect(Array.isArray(event.timedOutRoles)).toBe(true);
      expect(Array.isArray(event.retriedRoles)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Custom test adapters
// ---------------------------------------------------------------------------

/** Adapter that returns configurable output per role. */
class OutputDispatchAdapter extends AgentDispatchPort {
  private _dispatched: AgentDispatchConfig[] = [];

  constructor(private readonly outputByRole: Record<string, string>) {
    super();
  }

  async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
    this._dispatched.push(config);
    const output = this.outputByRole[config.agentType] ?? "[]";
    return ok(
      new AgentResultBuilder()
        .withTaskId(config.taskId)
        .withAgentType(config.agentType)
        .withOutput(output)
        .build(),
    );
  }

  async abort(): Promise<void> {
    /* no-op */
  }

  isRunning(): boolean {
    return false;
  }

  get dispatchedConfigs(): readonly AgentDispatchConfig[] {
    return this._dispatched;
  }
}

/** Adapter that delays all dispatches beyond a given time (to test timeout). */
class SlowDispatchAdapter extends AgentDispatchPort {
  private _dispatched: AgentDispatchConfig[] = [];
  private _abortCount = 0;
  private _running = new Map<
    string,
    {
      resolve: (v: Result<AgentResult, AgentDispatchError>) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(private readonly delayMs: number) {
    super();
  }

  async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
    this._dispatched.push(config);
    return new Promise<Result<AgentResult, AgentDispatchError>>((resolve) => {
      const timer = setTimeout(() => {
        this._running.delete(config.taskId);
        resolve(ok(new AgentResultBuilder().withTaskId(config.taskId).build()));
      }, this.delayMs);
      this._running.set(config.taskId, { resolve, timer });
    });
  }

  async abort(taskId: string): Promise<void> {
    this._abortCount++;
    const pending = this._running.get(taskId);
    if (pending) {
      clearTimeout(pending.timer);
      this._running.delete(taskId);
      pending.resolve(err(AgentDispatchError.sessionAborted(taskId)));
    }
  }

  isRunning(taskId: string): boolean {
    return this._running.has(taskId);
  }

  get dispatchCount(): number {
    return this._dispatched.length;
  }

  get abortCount(): number {
    return this._abortCount;
  }

  get dispatchedConfigs(): readonly AgentDispatchConfig[] {
    return this._dispatched;
  }
}

/**
 * Dispatch adapter that returns different outputs per dispatch cycle (group of 3).
 * Cycle 0 = dispatches 0-2, Cycle 1 = dispatches 3-5, etc.
 */
class CycleAwareDispatchAdapter extends AgentDispatchPort {
  private _dispatched: AgentDispatchConfig[] = [];

  constructor(private readonly outputByCycleAndRole: Array<Record<string, string>>) {
    super();
  }

  async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
    this._dispatched.push(config);
    const cycle = Math.floor((this._dispatched.length - 1) / 3);
    const cycleOutputs =
      this.outputByCycleAndRole[Math.min(cycle, this.outputByCycleAndRole.length - 1)];
    const output = cycleOutputs[config.agentType] ?? "[]";
    return ok(
      new AgentResultBuilder()
        .withTaskId(config.taskId)
        .withAgentType(config.agentType)
        .withOutput(output)
        .build(),
    );
  }

  async abort(): Promise<void> {
    /* no-op */
  }

  isRunning(): boolean {
    return false;
  }

  get dispatchedConfigs(): readonly AgentDispatchConfig[] {
    return this._dispatched;
  }
}

/** Adapter where specified roles always fail, others succeed. */
class PartialFailDispatchAdapter extends AgentDispatchPort {
  private _dispatched: AgentDispatchConfig[] = [];

  constructor(private readonly failingRoles: string[]) {
    super();
  }

  async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
    this._dispatched.push(config);
    if (this.failingRoles.includes(config.agentType)) {
      return err(AgentDispatchError.unexpectedFailure(config.taskId, `${config.agentType} failed`));
    }
    return ok(
      new AgentResultBuilder().withTaskId(config.taskId).withAgentType(config.agentType).build(),
    );
  }

  async abort(): Promise<void> {
    /* no-op */
  }

  isRunning(): boolean {
    return false;
  }

  get dispatchedConfigs(): readonly AgentDispatchConfig[] {
    return this._dispatched;
  }
}

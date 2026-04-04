import { randomUUID } from "node:crypto";
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
import { ExecutorQueryError } from "../domain/errors/executor-query.error";
import { FixerError } from "../domain/errors/fixer.error";
import { SliceSpecError } from "../domain/errors/review-context.error";
import type { ReviewUIError } from "../domain/errors/review-ui.error";
import { VerifyError } from "../domain/errors/verify.error";
import { VerificationCompletedEvent } from "../domain/events/verification-completed.event";
import { ExecutorQueryPort } from "../domain/ports/executor-query.port";
import { FixerPort, type FixRequest, type FixResult } from "../domain/ports/fixer.port";
import { ReviewUIPort } from "../domain/ports/review-ui.port";
import { type SliceSpec, SliceSpecPort } from "../domain/ports/slice-spec.port";
import type { FindingProps } from "../domain/schemas/review.schemas";
import type {
  ApprovalUIContext,
  ApprovalUIResponse,
  FindingsUIContext,
  FindingsUIResponse,
  VerificationUIContext,
  VerificationUIResponse,
} from "../domain/schemas/review-ui.schemas";
import { FreshReviewerService } from "../domain/services/fresh-reviewer.service";
import type { CriterionVerdictProps } from "../domain/schemas/verification.schemas";
import { InMemoryVerificationRepository } from "../infrastructure/repositories/verification/in-memory-verification.repository";
import { VerifyAcceptanceCriteriaUseCase } from "./verify-acceptance-criteria.use-case";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SLICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const WORKING_DIR = "/tmp/worktree";

const STUB_SPEC: SliceSpec = {
  sliceId: SLICE_ID,
  sliceLabel: "M05-S08",
  sliceTitle: "Acceptance criteria verification",
  specContent: "Verify acceptance criteria spec content",
  acceptanceCriteria: "- AC1: All tests pass\n- AC2: No regressions",
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

class StubExecutorQueryPort extends ExecutorQueryPort {
  async getSliceExecutors(): Promise<Result<ReadonlySet<string>, never>> {
    return ok(new Set<string>());
  }
}

class ViolatingExecutorQueryPort extends ExecutorQueryPort {
  async getSliceExecutors(): Promise<Result<ReadonlySet<string>, ExecutorQueryError>> {
    return ok(new MatchAllSet());
  }
}

class MatchAllSet extends Set<string> {
  override has(_value: string): boolean {
    return true;
  }
}

class FailingExecutorQueryPort extends ExecutorQueryPort {
  async getSliceExecutors(): Promise<Result<ReadonlySet<string>, ExecutorQueryError>> {
    return err(new ExecutorQueryError("Database connection failed"));
  }
}

class StubAgentDispatch extends AgentDispatchPort {
  private _dispatched: AgentDispatchConfig[] = [];
  private _responses: Array<Result<AgentResult, AgentDispatchError>> = [];
  private _callIndex = 0;

  constructor(responses?: Array<Result<AgentResult, AgentDispatchError>>) {
    super();
    if (responses) {
      this._responses = responses;
    }
  }

  withResponse(result: Result<AgentResult, AgentDispatchError>): this {
    this._responses.push(result);
    return this;
  }

  async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
    this._dispatched.push(config);
    const idx = this._callIndex++;
    if (idx < this._responses.length) {
      return this._responses[idx];
    }
    // Default: return ok with empty output
    return ok(
      new AgentResultBuilder()
        .withTaskId(config.taskId)
        .withAgentType(config.agentType)
        .withOutput("[]")
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

class StubFixerPort extends FixerPort {
  readonly fixCalls: Array<{ sliceId: string; findings: FindingProps[] }> = [];
  private _results: Array<Result<FixResult, FixerError>> = [];
  private _callIndex = 0;

  withResult(result: Result<FixResult, FixerError>): this {
    this._results.push(result);
    return this;
  }

  async fix(request: FixRequest): Promise<Result<FixResult, FixerError>> {
    this.fixCalls.push({ sliceId: request.sliceId, findings: [...request.findings] });
    const idx = this._callIndex++;
    if (idx < this._results.length) {
      return this._results[idx];
    }
    return ok({
      fixed: [],
      deferred: [...request.findings],
      justifications: {},
      testsPassing: true,
    });
  }
}

class StubReviewUIPort extends ReviewUIPort {
  readonly presentVerificationCalls: VerificationUIContext[] = [];

  async presentFindings(
    _context: FindingsUIContext,
  ): Promise<Result<FindingsUIResponse, ReviewUIError>> {
    return ok({ acknowledged: true, formattedOutput: "ok" });
  }

  async presentVerification(
    context: VerificationUIContext,
  ): Promise<Result<VerificationUIResponse, ReviewUIError>> {
    this.presentVerificationCalls.push(context);
    return ok({ accepted: true, formattedOutput: "ok" });
  }

  async presentForApproval(
    _context: ApprovalUIContext,
  ): Promise<Result<ApprovalUIResponse, ReviewUIError>> {
    return ok({ formattedOutput: "ok" });
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

const FIXED_DATE = new Date("2026-04-01T12:00:00.000Z");

class FixedDateProvider implements DateProviderPort {
  now(): Date {
    return FIXED_DATE;
  }
}

function stubModelResolver(_profile: ModelProfileName): ResolvedModel {
  return { provider: "anthropic", modelId: "claude-sonnet-4-6" };
}

function stubTemplateLoader(_path: string): string {
  return "Verify {{sliceLabel}} {{sliceTitle}} {{specContent}} {{acceptanceCriteria}} {{workingDirectory}}";
}

let idCounter = 0;
function resetIdCounter(): void {
  idCounter = 0;
}
function deterministicId(): string {
  // Version 4 UUID with valid variant (8xxx)
  return `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`;
}

function makeVerdicts(
  overrides?: Array<Partial<CriterionVerdictProps> | undefined>,
): CriterionVerdictProps[] {
  const defaults: CriterionVerdictProps[] = [
    { criterion: "AC1: All tests pass", verdict: "PASS", evidence: "ran vitest, 42 tests pass" },
    { criterion: "AC2: No regressions", verdict: "PASS", evidence: "no failures detected" },
  ];
  if (!overrides) return defaults;
  return defaults.map((d, i) => {
    const override = overrides[i];
    return override ? { ...d, ...override } : d;
  });
}

function makeVerdictsOutput(verdicts: CriterionVerdictProps[]): string {
  return JSON.stringify(verdicts);
}

function makePassingOutput(): string {
  return makeVerdictsOutput(makeVerdicts());
}

function makeFailingOutput(): string {
  return makeVerdictsOutput(
    makeVerdicts([undefined, { verdict: "FAIL", evidence: "regression found in foo.ts" }]),
  );
}

interface BuildUseCaseOverrides {
  sliceSpecPort?: SliceSpecPort;
  agentDispatchPort?: AgentDispatchPort;
  executorQueryPort?: ExecutorQueryPort;
  freshReviewerService?: FreshReviewerService;
  fixerPort?: StubFixerPort;
  verificationRepository?: InMemoryVerificationRepository;
  reviewUIPort?: StubReviewUIPort;
  eventBus?: EventBusPort;
  dateProvider?: DateProviderPort;
  generateId?: () => string;
}

function buildUseCase(overrides: BuildUseCaseOverrides = {}): VerifyAcceptanceCriteriaUseCase {
  const executorQueryPort = overrides.executorQueryPort ?? new StubExecutorQueryPort();
  const freshReviewerService =
    overrides.freshReviewerService ?? new FreshReviewerService(executorQueryPort);
  const fixerPort = overrides.fixerPort ?? new StubFixerPort();
  const verificationRepository =
    overrides.verificationRepository ?? new InMemoryVerificationRepository();
  const reviewUIPort = overrides.reviewUIPort ?? new StubReviewUIPort();
  const eventBus = overrides.eventBus ?? new InProcessEventBus(logger);
  const dateProvider = overrides.dateProvider ?? new SystemDateProvider();
  const generateId = overrides.generateId ?? deterministicId;
  const sliceSpecPort = overrides.sliceSpecPort ?? new StubSliceSpecPort(ok(STUB_SPEC));
  const agentDispatchPort =
    overrides.agentDispatchPort ??
    new StubAgentDispatch([
      ok(
        new AgentResultBuilder()
          .withTaskId(randomUUID())
          .withAgentType("verifier")
          .withOutput(makePassingOutput())
          .build(),
      ),
    ]);

  return new VerifyAcceptanceCriteriaUseCase(
    sliceSpecPort,
    freshReviewerService,
    agentDispatchPort,
    fixerPort,
    verificationRepository,
    reviewUIPort,
    stubModelResolver,
    eventBus,
    dateProvider,
    generateId,
    logger,
    stubTemplateLoader,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("VerifyAcceptanceCriteriaUseCase", () => {
  describe("happy path — all PASS", () => {
    it("returns ok with all criteria passing and finalVerdict PASS", async () => {
      resetIdCounter();
      const dispatch = new StubAgentDispatch([
        ok(
          new AgentResultBuilder()
            .withTaskId(randomUUID())
            .withAgentType("verifier")
            .withOutput(makePassingOutput())
            .build(),
        ),
      ]);
      const verificationRepo = new InMemoryVerificationRepository();
      const eventBus = new SpyEventBus(logger);
      const reviewUIPort = new StubReviewUIPort();

      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        verificationRepository: verificationRepo,
        eventBus,
        reviewUIPort,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.finalVerdict).toBe("PASS");
        expect(result.data.fixCyclesUsed).toBe(0);
        expect(result.data.retriedVerification).toBe(false);
        expect(result.data.verifications).toHaveLength(1);
        expect(result.data.verifications[0].criteria).toHaveLength(2);
        expect(result.data.verifications[0].criteria.every((c) => c.verdict === "PASS")).toBe(true);
      }

      // Verification saved
      const savedResult = await verificationRepo.findBySliceId(SLICE_ID);
      expect(savedResult.ok).toBe(true);
      if (savedResult.ok) {
        expect(savedResult.data).toHaveLength(1);
      }

      // UI presented
      expect(reviewUIPort.presentVerificationCalls).toHaveLength(1);

      // Event emitted
      const events = eventBus.publishedEvents.filter(
        (e) => e instanceof VerificationCompletedEvent,
      );
      expect(events).toHaveLength(1);
      const event = events[0] as VerificationCompletedEvent;
      expect(event.finalVerdict).toBe("PASS");
      expect(event.fixCyclesUsed).toBe(0);
      expect(event.retriedVerification).toBe(false);
    });
  });

  describe("fresh-reviewer violation", () => {
    it("returns VerifyError.freshReviewerBlocked()", async () => {
      resetIdCounter();
      const executorQueryPort = new ViolatingExecutorQueryPort();
      const freshReviewerService = new FreshReviewerService(executorQueryPort);
      const useCase = buildUseCase({ executorQueryPort, freshReviewerService });

      const result = await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(VerifyError);
        expect(result.error.code).toBe("VERIFY.FRESH_REVIEWER_BLOCKED");
      }
    });
  });

  describe("context resolution failure (SliceSpecPort error)", () => {
    it("returns VerifyError.contextResolutionFailed()", async () => {
      resetIdCounter();
      const useCase = buildUseCase({
        sliceSpecPort: new StubSliceSpecPort(err(new SliceSpecError("spec not found"))),
      });

      const result = await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(VerifyError);
        expect(result.error.code).toBe("VERIFY.CONTEXT_RESOLUTION_FAILED");
      }
    });
  });

  describe("context resolution failure (ExecutorQueryError)", () => {
    it("returns VerifyError.contextResolutionFailed() on fail-closed", async () => {
      resetIdCounter();
      const executorQueryPort = new FailingExecutorQueryPort();
      const freshReviewerService = new FreshReviewerService(executorQueryPort);
      const useCase = buildUseCase({ executorQueryPort, freshReviewerService });

      const result = await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(VerifyError);
        expect(result.error.code).toBe("VERIFY.CONTEXT_RESOLUTION_FAILED");
      }
    });
  });

  describe("dispatch failure + retry success", () => {
    it("returns ok with retriedVerification = true", async () => {
      resetIdCounter();
      const dispatch = new StubAgentDispatch([
        // First attempt: fail
        err(AgentDispatchError.unexpectedFailure(randomUUID(), "simulated failure")),
        // Retry: success
        ok(
          new AgentResultBuilder()
            .withTaskId(randomUUID())
            .withAgentType("verifier")
            .withOutput(makePassingOutput())
            .build(),
        ),
      ]);

      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.retriedVerification).toBe(true);
        expect(result.data.finalVerdict).toBe("PASS");
      }
    });
  });

  describe("dispatch failure + retry failure", () => {
    it("returns VerifyError.verifierFailed()", async () => {
      resetIdCounter();
      const dispatch = new StubAgentDispatch([
        err(AgentDispatchError.unexpectedFailure(randomUUID(), "first failure")),
        err(AgentDispatchError.unexpectedFailure(randomUUID(), "second failure")),
      ]);

      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(VerifyError);
        expect(result.error.code).toBe("VERIFY.VERIFIER_FAILED");
      }
    });
  });

  describe("parse error (malformed output)", () => {
    it("returns VerifyError.parseError()", async () => {
      resetIdCounter();
      const dispatch = new StubAgentDispatch([
        ok(
          new AgentResultBuilder()
            .withTaskId(randomUUID())
            .withAgentType("verifier")
            .withOutput("not valid json at all")
            .build(),
        ),
      ]);

      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(VerifyError);
        expect(result.error.code).toBe("VERIFY.PARSE_ERROR");
      }
    });
  });

  describe("parse error (empty array)", () => {
    it("returns VerifyError.parseError()", async () => {
      resetIdCounter();
      const dispatch = new StubAgentDispatch([
        ok(
          new AgentResultBuilder()
            .withTaskId(randomUUID())
            .withAgentType("verifier")
            .withOutput("[]")
            .build(),
        ),
      ]);

      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(VerifyError);
        expect(result.error.code).toBe("VERIFY.PARSE_ERROR");
      }
    });
  });

  describe("fixer loop — FAIL then PASS after fix", () => {
    it("runs one fix cycle then passes on re-verification", async () => {
      resetIdCounter();
      const dispatch = new StubAgentDispatch([
        // Cycle 0: FAIL
        ok(
          new AgentResultBuilder()
            .withTaskId(randomUUID())
            .withAgentType("verifier")
            .withOutput(makeFailingOutput())
            .build(),
        ),
        // Cycle 1 (after fix): PASS
        ok(
          new AgentResultBuilder()
            .withTaskId(randomUUID())
            .withAgentType("verifier")
            .withOutput(makePassingOutput())
            .build(),
        ),
      ]);

      const fixerPort = new StubFixerPort();
      const verificationRepo = new InMemoryVerificationRepository();

      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        fixerPort,
        verificationRepository: verificationRepo,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.finalVerdict).toBe("PASS");
        expect(result.data.fixCyclesUsed).toBe(1);
        expect(result.data.verifications).toHaveLength(2);
      }
      expect(fixerPort.fixCalls).toHaveLength(1);
      expect(fixerPort.fixCalls[0].sliceId).toBe(SLICE_ID);
    });
  });

  describe("fixer loop — max cycles exhausted", () => {
    it("stops after maxFixCycles with finalVerdict FAIL", async () => {
      resetIdCounter();
      const dispatch = new StubAgentDispatch([
        // Cycle 0: FAIL
        ok(
          new AgentResultBuilder()
            .withTaskId(randomUUID())
            .withAgentType("verifier")
            .withOutput(makeFailingOutput())
            .build(),
        ),
        // Cycle 1 (after fix 1): FAIL
        ok(
          new AgentResultBuilder()
            .withTaskId(randomUUID())
            .withAgentType("verifier")
            .withOutput(makeFailingOutput())
            .build(),
        ),
        // Cycle 2 (after fix 2): FAIL
        ok(
          new AgentResultBuilder()
            .withTaskId(randomUUID())
            .withAgentType("verifier")
            .withOutput(makeFailingOutput())
            .build(),
        ),
      ]);

      const fixerPort = new StubFixerPort();

      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        fixerPort,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.finalVerdict).toBe("FAIL");
        expect(result.data.fixCyclesUsed).toBe(2);
        expect(result.data.verifications).toHaveLength(3);
      }
      expect(fixerPort.fixCalls).toHaveLength(2);
    });
  });

  describe("fixer failure — graceful stop", () => {
    it("returns ok result (not error) with current verification when fixer fails", async () => {
      resetIdCounter();
      const dispatch = new StubAgentDispatch([
        ok(
          new AgentResultBuilder()
            .withTaskId(randomUUID())
            .withAgentType("verifier")
            .withOutput(makeFailingOutput())
            .build(),
        ),
      ]);

      const fixerPort = new StubFixerPort().withResult(err(new FixerError("Fixer exploded")));

      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        fixerPort,
        dateProvider: new FixedDateProvider(),
      });

      const result = await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      // Graceful: ok result, not error
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.fixCyclesUsed).toBe(0);
        expect(result.data.finalVerdict).toBe("FAIL");
        expect(result.data.verifications).toHaveLength(1);
      }
    });
  });

  describe("dispatch config verification", () => {
    it("dispatches with correct agentType, model, and tools", async () => {
      resetIdCounter();
      const dispatch = new StubAgentDispatch([
        ok(
          new AgentResultBuilder()
            .withTaskId(randomUUID())
            .withAgentType("verifier")
            .withOutput(makePassingOutput())
            .build(),
        ),
      ]);

      const useCase = buildUseCase({
        agentDispatchPort: dispatch,
        dateProvider: new FixedDateProvider(),
      });

      await useCase.execute({
        sliceId: SLICE_ID,
        workingDirectory: WORKING_DIR,
        timeoutMs: 300_000,
        maxFixCycles: 2,
      });

      expect(dispatch.dispatchedConfigs).toHaveLength(1);
      const config = dispatch.dispatchedConfigs[0];
      expect(config.agentType).toBe("verifier");
      expect(config.model).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
      expect(config.tools).toEqual(["Read", "Grep", "Glob", "Bash"]);
      expect(config.sliceId).toBe(SLICE_ID);
      expect(config.workingDirectory).toBe(WORKING_DIR);
    });
  });
});

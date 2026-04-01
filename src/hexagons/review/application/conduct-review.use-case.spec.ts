import { InMemoryAgentDispatchAdapter } from "@hexagons/execution";
import {
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
import { describe, expect, it } from "vitest";
import type { ConductReviewRequest } from "../domain/conduct-review.schemas";
import { ConductReviewError } from "../domain/errors/conduct-review.error";
import { ChangedFilesError, SliceSpecError } from "../domain/errors/review-context.error";
import { ChangedFilesPort } from "../domain/ports/changed-files.port";
import { ExecutorQueryPort } from "../domain/ports/executor-query.port";
import { FixerPort } from "../domain/ports/fixer.port";
import { type SliceSpec, SliceSpecPort } from "../domain/ports/slice-spec.port";
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

class StubFixerPort extends FixerPort {
  async fix(): Promise<never> {
    throw new Error("StubFixerPort.fix not expected in T08");
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

function buildUseCase(
  overrides: {
    sliceSpecPort?: SliceSpecPort;
    changedFilesPort?: ChangedFilesPort;
    agentDispatchPort?: AgentDispatchPort;
  } = {},
): ConductReviewUseCase {
  const sliceSpecPort = overrides.sliceSpecPort ?? new StubSliceSpecPort(ok(STUB_SPEC));
  const changedFilesPort =
    overrides.changedFilesPort ?? new StubChangedFilesPort(ok("diff --git a/foo.ts b/foo.ts"));
  const executorQueryPort = new StubExecutorQueryPort();
  const freshReviewerService = new FreshReviewerService(executorQueryPort);
  const critiqueReflectionService = new CritiqueReflectionService();
  const promptBuilder = new ReviewPromptBuilder(stubTemplateLoader);
  const fixerPort = new StubFixerPort();
  const reviewRepository = new InMemoryReviewRepository();
  const eventBus = new InProcessEventBus(logger);
  const dateProvider = new SystemDateProvider();
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
});

// ---------------------------------------------------------------------------
// Custom test adapters
// ---------------------------------------------------------------------------

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

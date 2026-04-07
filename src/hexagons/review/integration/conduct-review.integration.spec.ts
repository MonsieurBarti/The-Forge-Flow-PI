import { InMemoryAgentDispatchAdapter } from "@hexagons/execution";
import {
  type DomainEvent,
  InProcessEventBus,
  type ModelProfileName,
  ok,
  type ResolvedModel,
  SilentLoggerAdapter,
  SystemDateProvider,
} from "@kernel";
import {
  type AgentDispatchConfig,
  AgentDispatchPort,
  type AgentResult,
  AgentResultBuilder,
} from "@kernel/agents";
import type { Result } from "@kernel/result";
import { describe, expect, it } from "vitest";
import { ConductReviewUseCase } from "../application/conduct-review.use-case";
import { ReviewPromptBuilder } from "../application/review-prompt-builder";
import { ReviewPipelineCompletedEvent } from "../domain/events/review-pipeline-completed.event";
import { ChangedFilesPort } from "../domain/ports/changed-files.port";
import { ExecutorQueryPort } from "../domain/ports/executor-query.port";
import type { FixerPort } from "../domain/ports/fixer.port";
import { type SliceSpec, SliceSpecPort } from "../domain/ports/slice-spec.port";
import type { ConductReviewRequest } from "../domain/schemas/conduct-review.schemas";
import type { FindingProps } from "../domain/schemas/review.schemas";
import { CritiqueReflectionService } from "../domain/services/critique-reflection.service";
import { FreshReviewerService } from "../domain/services/fresh-reviewer.service";
import { StubFixerAdapter } from "../infrastructure/adapters/fixer/stub-fixer.adapter";
import { InMemoryReviewRepository } from "../infrastructure/repositories/review/in-memory-review.repository";

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
// Stub ports (InMemory-style)
// ---------------------------------------------------------------------------
class StubSliceSpecPort extends SliceSpecPort {
  constructor(private readonly spec: SliceSpec) {
    super();
  }
  async getSpec(): ReturnType<SliceSpecPort["getSpec"]> {
    return ok(this.spec);
  }
}

class StubChangedFilesPort extends ChangedFilesPort {
  constructor(private readonly diff: string) {
    super();
  }
  async getDiff(): ReturnType<ChangedFilesPort["getDiff"]> {
    return ok(this.diff);
  }
}

class StubExecutorQueryPort extends ExecutorQueryPort {
  async getSliceExecutors(): Promise<Result<ReadonlySet<string>, never>> {
    return ok(new Set<string>());
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

/** Adapter that returns configurable output per role. */
class OutputDispatchAdapter extends AgentDispatchPort {
  private _dispatched: AgentDispatchConfig[] = [];

  constructor(private readonly outputByRole: Record<string, string>) {
    super();
  }

  async dispatch(
    config: AgentDispatchConfig,
  ): Promise<Result<AgentResult, import("@kernel/agents").AgentDispatchError>> {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const logger = new SilentLoggerAdapter();

function stubTemplateLoader(_path: string): string {
  return "Review {{sliceLabel}} {{sliceTitle}} {{sliceId}} {{reviewRole}} {{changedFiles}} {{acceptanceCriteria}}";
}

function stubModelResolver(_profile: ModelProfileName): ResolvedModel {
  return { provider: "anthropic", modelId: "claude-sonnet-4-6" };
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

function makeRequest(overrides?: Partial<ConductReviewRequest>): ConductReviewRequest {
  return {
    sliceId: SLICE_ID,
    workingDirectory: WORKING_DIR,
    timeoutMs: 300_000,
    maxFixCycles: 0,
    ...overrides,
  };
}

interface BuildIntegrationOverrides {
  agentDispatchPort?: AgentDispatchPort;
  fixerPort?: FixerPort;
  eventBus?: SpyEventBus;
  reviewRepository?: InMemoryReviewRepository;
}

function buildUseCase(overrides: BuildIntegrationOverrides = {}) {
  const eventBus = overrides.eventBus ?? new SpyEventBus(logger);
  const reviewRepository = overrides.reviewRepository ?? new InMemoryReviewRepository();
  const executorQueryPort = new StubExecutorQueryPort();
  const freshReviewerService = new FreshReviewerService(executorQueryPort);
  const critiqueReflectionService = new CritiqueReflectionService();
  const promptBuilder = new ReviewPromptBuilder(stubTemplateLoader);
  const fixerPort = overrides.fixerPort ?? new StubFixerAdapter();
  const dateProvider = new SystemDateProvider();
  const agentDispatchPort = overrides.agentDispatchPort ?? new InMemoryAgentDispatchAdapter();

  const useCase = new ConductReviewUseCase(
    new StubSliceSpecPort(STUB_SPEC),
    new StubChangedFilesPort("diff --git a/foo.ts b/foo.ts\n+const x = 1;"),
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

  return { useCase, eventBus, reviewRepository };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ConductReview Integration", () => {
  it("full pipeline with 3 stub reviewers -> merged result + event emitted", async () => {
    const finding1 = makeFinding({
      severity: "medium",
      message: "Code issue",
      filePath: "src/code.ts",
      lineStart: 10,
    });
    const finding2 = makeFinding({
      severity: "low",
      message: "Spec nit",
      filePath: "src/spec.ts",
      lineStart: 20,
    });
    const finding3 = makeFinding({
      severity: "medium",
      message: "Security advisory",
      filePath: "src/security.ts",
      lineStart: 30,
    });

    const dispatch = new OutputDispatchAdapter({
      "tff-code-reviewer": makeCtrOutput([finding1]),
      "tff-spec-reviewer": makeStandardOutput([finding2]),
      "tff-security-auditor": makeCtrOutput([finding3]),
    });

    const eventBus = new SpyEventBus(logger);
    const reviewRepository = new InMemoryReviewRepository();

    const { useCase } = buildUseCase({
      agentDispatchPort: dispatch,
      eventBus,
      reviewRepository,
    });

    const result = await useCase.execute(makeRequest());

    // Assert: pipeline succeeded
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Assert: 3 individual reviews
    expect(result.data.individualReviews).toHaveLength(3);
    const roles = result.data.individualReviews.map((r) => r.role).sort();
    expect(roles).toEqual(["tff-code-reviewer", "tff-security-auditor", "tff-spec-reviewer"]);

    // Assert: merged review with 3 sourceReviewIds
    expect(result.data.mergedReview.sourceReviewIds).toHaveLength(3);
    const individualIds = result.data.individualReviews.map((r) => r.id);
    for (const sourceId of result.data.mergedReview.sourceReviewIds) {
      expect(individualIds).toContain(sourceId);
    }

    // Assert: merged review has findings from all 3 reviewers
    expect(result.data.mergedReview.findings.length).toBeGreaterThanOrEqual(2);

    // Assert: fixCyclesUsed is 0 (maxFixCycles=0)
    expect(result.data.fixCyclesUsed).toBe(0);

    // Assert: event was published
    const pipelineEvents = eventBus.publishedEvents.filter(
      (e) => e instanceof ReviewPipelineCompletedEvent,
    );
    expect(pipelineEvents).toHaveLength(1);

    const event = pipelineEvents[0] as ReviewPipelineCompletedEvent;
    expect(event.sliceId).toBe(SLICE_ID);
    expect(event.verdict).toBeDefined();
    expect(event.reviewCount).toBe(3);
    expect(typeof event.findingsCount).toBe("number");
    expect(typeof event.blockerCount).toBe("number");
    expect(typeof event.conflictCount).toBe("number");
    expect(event.fixCyclesUsed).toBe(0);

    // Assert: reviews persisted to repository
    const savedResult = await reviewRepository.findBySliceId(SLICE_ID);
    expect(savedResult.ok).toBe(true);
    if (savedResult.ok) {
      expect(savedResult.data).toHaveLength(3);
    }
  });

  it("dispatches exactly 3 agents via InMemoryAgentDispatchAdapter", async () => {
    const dispatch = new InMemoryAgentDispatchAdapter();
    const { useCase } = buildUseCase({ agentDispatchPort: dispatch });

    const result = await useCase.execute(makeRequest());

    expect(result.ok).toBe(true);
    expect(dispatch.dispatchedConfigs).toHaveLength(3);
    const agentTypes = dispatch.dispatchedConfigs.map((c) => c.agentType);
    expect(agentTypes).toContain("tff-code-reviewer");
    expect(agentTypes).toContain("tff-spec-reviewer");
    expect(agentTypes).toContain("tff-security-auditor");
  });

  it("each reviewer gets a distinct identity (unique taskId)", async () => {
    const dispatch = new InMemoryAgentDispatchAdapter();
    const { useCase } = buildUseCase({ agentDispatchPort: dispatch });

    await useCase.execute(makeRequest());

    const taskIds = dispatch.dispatchedConfigs.map((c) => c.taskId);
    const uniqueTaskIds = new Set(taskIds);
    expect(uniqueTaskIds.size).toBe(3);
  });

  it("uses StubFixerAdapter without errors when maxFixCycles=0", async () => {
    const { useCase } = buildUseCase({
      fixerPort: new StubFixerAdapter(),
    });

    const result = await useCase.execute(makeRequest({ maxFixCycles: 0 }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.fixCyclesUsed).toBe(0);
    }
  });
});

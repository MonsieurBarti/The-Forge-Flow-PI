import { faker } from "@faker-js/faker";
import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { WorkflowSliceTransitionAdapter } from "@hexagons/slice/infrastructure/workflow-slice-transition.adapter";
import type { DomainEvent } from "@kernel";
import {
  DateProviderPort,
  EVENT_NAMES,
  InProcessEventBus,
  isErr,
  isOk,
  SilentLoggerAdapter,
} from "@kernel";
import { describe, expect, it, vi } from "vitest";
import { WorkflowPhaseChangedEvent } from "../domain/events/workflow-phase-changed.event";
import type {
  WorkflowJournalEntry,
  WorkflowJournalPort,
} from "../domain/ports/workflow-journal.port";
import { WorkflowSessionBuilder } from "../domain/workflow-session.builder";
import type { GuardContext } from "../domain/workflow-session.schemas";
import { InMemoryWorkflowSessionRepository } from "../infrastructure/in-memory-workflow-session.repository";
import {
  OrchestratePhaseTransitionUseCase,
  PHASE_SUCCESS_TRIGGERS,
} from "./orchestrate-phase-transition.use-case";

class StubDateProvider extends DateProviderPort {
  private _now = new Date("2026-01-15T10:00:00Z");
  now(): Date {
    return this._now;
  }
}

const DEFAULT_GUARD_CTX: GuardContext = {
  complexityTier: "F-lite",
  retryCount: 0,
  maxRetries: 2,
  allSlicesClosed: false,
  lastError: null,
  failurePolicy: "strict",
};

function setup() {
  const sessionRepo = new InMemoryWorkflowSessionRepository();
  const sliceRepo = new InMemorySliceRepository();
  const dateProvider = new StubDateProvider();
  const sliceTransitionPort = new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider);
  const eventBus = new InProcessEventBus(new SilentLoggerAdapter());
  const useCase = new OrchestratePhaseTransitionUseCase(
    sessionRepo,
    sliceTransitionPort,
    eventBus,
    dateProvider,
  );
  return { useCase, sessionRepo, sliceRepo, sliceTransitionPort, eventBus, dateProvider };
}

function seedSlice(repo: InMemorySliceRepository, id: string, status: SliceStatus): void {
  repo.seed(
    Slice.reconstitute({
      id,
      milestoneId: faker.string.uuid(),
      kind: "milestone" as const,
      label: "M01-S01",
      title: "Test",
      description: "",
      status,
      complexity: null,
      specPath: null,
      planPath: null,
      researchPath: null,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  );
}

describe("OrchestratePhaseTransitionUseCase", () => {
  it("triggers session and transitions slice on standard phase change", async () => {
    const { useCase, sessionRepo, sliceRepo } = setup();
    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withCurrentPhase("discussing")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "discussing");

    const result = await useCase.execute({
      milestoneId: session.milestoneId as string,
      trigger: "next",
      guardContext: { ...DEFAULT_GUARD_CTX, complexityTier: "F-lite" },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.fromPhase).toBe("discussing");
      expect(result.data.toPhase).toBe("researching");
      expect(result.data.sliceTransitioned).toBe(true);
    }
    const reloaded = await sliceRepo.findById(sliceId);
    if (isOk(reloaded) && reloaded.data) {
      expect(reloaded.data.status).toBe("researching");
    }
  });

  it("transitions slice to closed on shipping + next -> idle", async () => {
    const { useCase, sessionRepo, sliceRepo } = setup();
    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withCurrentPhase("shipping")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "completing");

    const result = await useCase.execute({
      milestoneId: session.milestoneId as string,
      trigger: "next",
      guardContext: DEFAULT_GUARD_CTX,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.toPhase).toBe("idle");
      expect(result.data.sliceTransitioned).toBe(true);
    }
    const reloaded = await sliceRepo.findById(sliceId);
    if (isOk(reloaded) && reloaded.data) {
      expect(reloaded.data.status).toBe("closed");
    }
  });

  it("does NOT transition slice on blocked + abort -> idle", async () => {
    const { useCase, sessionRepo, sliceRepo } = setup();
    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withCurrentPhase("blocked")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "executing");

    const result = await useCase.execute({
      milestoneId: session.milestoneId as string,
      trigger: "abort",
      guardContext: DEFAULT_GUARD_CTX,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.toPhase).toBe("idle");
      expect(result.data.sliceTransitioned).toBe(false);
    }
    const reloaded = await sliceRepo.findById(sliceId);
    if (isOk(reloaded) && reloaded.data) {
      expect(reloaded.data.status).toBe("executing");
    }
  });

  it("publishes WorkflowPhaseChangedEvent", async () => {
    const { useCase, sessionRepo, sliceRepo, eventBus } = setup();
    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withCurrentPhase("discussing")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "discussing");

    const published: DomainEvent[] = [];
    eventBus.subscribe(EVENT_NAMES.WORKFLOW_PHASE_CHANGED, async (e) => {
      published.push(e);
    });

    await useCase.execute({
      milestoneId: session.milestoneId as string,
      trigger: "next",
      guardContext: { ...DEFAULT_GUARD_CTX, complexityTier: "F-lite" },
    });

    expect(published).toHaveLength(1);
    const event = published[0];
    expect(event).toBeInstanceOf(WorkflowPhaseChangedEvent);
    if (event instanceof WorkflowPhaseChangedEvent) {
      expect(event.fromPhase).toBe("discussing");
      expect(event.toPhase).toBe("researching");
    }
  });

  it("skips slice transition when no sliceId assigned", async () => {
    const { useCase, sessionRepo } = setup();
    const session = new WorkflowSessionBuilder().withCurrentPhase("idle").build();
    sessionRepo.seed(session);

    const result = await useCase.execute({
      milestoneId: session.milestoneId as string,
      trigger: "start",
      guardContext: DEFAULT_GUARD_CTX,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.toPhase).toBe("discussing");
      expect(result.data.sliceTransitioned).toBe(false);
    }
  });

  it("returns error when session not found", async () => {
    const { useCase } = setup();

    const result = await useCase.execute({
      milestoneId: faker.string.uuid(),
      trigger: "next",
      guardContext: DEFAULT_GUARD_CTX,
    });

    expect(isErr(result)).toBe(true);
  });

  it("finds session by sliceId when milestoneId not provided", async () => {
    const { useCase, sessionRepo, sliceRepo } = setup();
    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withNullMilestoneId()
      .withCurrentPhase("discussing")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "discussing");

    const result = await useCase.execute({
      sliceId,
      trigger: "next",
      guardContext: { ...DEFAULT_GUARD_CTX, complexityTier: "F-lite" },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.fromPhase).toBe("discussing");
      expect(result.data.toPhase).toBe("researching");
    }
  });

  it("returns error when neither milestoneId nor sliceId provided", async () => {
    const { useCase } = setup();

    const result = await useCase.execute({
      trigger: "next",
      guardContext: DEFAULT_GUARD_CTX,
    });

    expect(isErr(result)).toBe(true);
  });

  it("prefers milestoneId over sliceId when both provided", async () => {
    const { useCase, sessionRepo, sliceRepo } = setup();
    const sliceId = faker.string.uuid();
    const milestoneSession = new WorkflowSessionBuilder()
      .withCurrentPhase("discussing")
      .withSliceId(sliceId)
      .build();
    const sliceOnlySession = new WorkflowSessionBuilder()
      .withNullMilestoneId()
      .withCurrentPhase("executing")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(milestoneSession);
    sessionRepo.seed(sliceOnlySession);
    seedSlice(sliceRepo, sliceId, "discussing");

    const result = await useCase.execute({
      milestoneId: milestoneSession.milestoneId as string,
      sliceId,
      trigger: "next",
      guardContext: { ...DEFAULT_GUARD_CTX, complexityTier: "F-lite" },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      // milestoneSession starts at "discussing", not "executing"
      expect(result.data.fromPhase).toBe("discussing");
    }
  });

  it("appends phase-transition entry to workflow journal", async () => {
    const { sessionRepo, sliceRepo, sliceTransitionPort, eventBus, dateProvider } = setup();
    const appendSpy = vi.fn(async (_entry: WorkflowJournalEntry) => ({
      ok: true as const,
      data: undefined,
    }));
    const mockJournal: WorkflowJournalPort = {
      append: appendSpy,
      readAll: async () => ({ ok: true as const, data: [] as WorkflowJournalEntry[] }),
    } as unknown as WorkflowJournalPort;

    const useCase = new OrchestratePhaseTransitionUseCase(
      sessionRepo,
      sliceTransitionPort,
      eventBus,
      dateProvider,
      mockJournal,
    );

    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withCurrentPhase("discussing")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "discussing");

    const result = await useCase.execute({
      milestoneId: session.milestoneId as string,
      trigger: "next",
      guardContext: { ...DEFAULT_GUARD_CTX, complexityTier: "F-lite" },
    });

    expect(isOk(result)).toBe(true);
    expect(appendSpy).toHaveBeenCalledOnce();
    const firstCall = appendSpy.mock.calls[0];
    if (!firstCall) throw new Error("Expected appendSpy to have been called");
    const entry = firstCall[0];
    expect(entry.type).toBe("phase-transition");
    expect(entry.sessionId).toBe(session.id);
    expect(entry.milestoneId).toBe(session.milestoneId);
    expect(entry.fromPhase).toBe("discussing");
    expect(entry.toPhase).toBe("researching");
  });
});

// ---------------------------------------------------------------------------
// Failure Policy Routing
// ---------------------------------------------------------------------------

function setupWithJournal() {
  const sessionRepo = new InMemoryWorkflowSessionRepository();
  const sliceRepo = new InMemorySliceRepository();
  const dateProvider = new StubDateProvider();
  const sliceTransitionPort = new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider);
  const eventBus = new InProcessEventBus(new SilentLoggerAdapter());
  const appendSpy = vi.fn(async (_entry: WorkflowJournalEntry) => ({
    ok: true as const,
    data: undefined,
  }));
  const mockJournal: WorkflowJournalPort = {
    append: appendSpy,
    readAll: async () => ({ ok: true as const, data: [] as WorkflowJournalEntry[] }),
  } as unknown as WorkflowJournalPort;
  const useCase = new OrchestratePhaseTransitionUseCase(
    sessionRepo,
    sliceTransitionPort,
    eventBus,
    dateProvider,
    mockJournal,
  );
  return { useCase, sessionRepo, sliceRepo, eventBus, dateProvider, appendSpy };
}

describe("Failure policy routing", () => {
  it("strict mode returns trigger error unchanged (default behavior)", async () => {
    const { useCase, sessionRepo } = setupWithJournal();
    // idle + "next" with allSlicesClosed=false will fail (guard blocks)
    const session = new WorkflowSessionBuilder().withCurrentPhase("idle").build();
    sessionRepo.seed(session);

    const result = await useCase.execute({
      milestoneId: session.milestoneId as string,
      trigger: "next",
      guardContext: { ...DEFAULT_GUARD_CTX, failurePolicy: "strict", allSlicesClosed: false },
    });

    expect(isErr(result)).toBe(true);
  });

  it("tolerant mode records FailureRecordedEntry then returns the error", async () => {
    const { useCase, sessionRepo, appendSpy } = setupWithJournal();
    const session = new WorkflowSessionBuilder().withCurrentPhase("idle").build();
    sessionRepo.seed(session);

    const result = await useCase.execute({
      milestoneId: session.milestoneId as string,
      trigger: "next",
      guardContext: { ...DEFAULT_GUARD_CTX, failurePolicy: "tolerant", allSlicesClosed: false },
    });

    expect(isErr(result)).toBe(true);
    expect(appendSpy).toHaveBeenCalledOnce();
    const entry = appendSpy.mock.calls[0]?.[0];
    expect(entry.type).toBe("failure-recorded");
    expect(entry.metadata).toMatchObject({
      phase: "idle",
      policy: "tolerant",
      action: "retried",
    });
  });

  it("lenient mode records FailureRecordedEntry and triggers success path", async () => {
    const { useCase, sessionRepo, sliceRepo, appendSpy } = setupWithJournal();
    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withCurrentPhase("discussing")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "discussing");

    // "approve" is not valid for "discussing" — it will fail.
    // Then lenient should look up PHASE_SUCCESS_TRIGGERS["discussing"] = "next" and try that instead.
    const result = await useCase.execute({
      milestoneId: session.milestoneId as string,
      trigger: "approve",
      guardContext: { ...DEFAULT_GUARD_CTX, failurePolicy: "lenient", complexityTier: "F-lite" },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.fromPhase).toBe("discussing");
      expect(result.data.toPhase).toBe("researching");
    }
    // Should have recorded a failure-recorded entry
    const failureEntry = appendSpy.mock.calls.find((c) => c[0].type === "failure-recorded");
    expect(failureEntry).toBeDefined();
    expect(failureEntry?.[0].metadata).toMatchObject({
      phase: "discussing",
      policy: "lenient",
      action: "continued",
    });
  });

  it("lenient mode with unknown phase falls back to strict (returns error)", async () => {
    const { useCase, sessionRepo, appendSpy } = setupWithJournal();
    // "completing-milestone" has no entry in PHASE_SUCCESS_TRIGGERS
    const session = new WorkflowSessionBuilder().withCurrentPhase("completing-milestone").build();
    sessionRepo.seed(session);

    // "approve" is not valid for "completing-milestone"
    const result = await useCase.execute({
      milestoneId: session.milestoneId as string,
      trigger: "approve",
      guardContext: { ...DEFAULT_GUARD_CTX, failurePolicy: "lenient" },
    });

    expect(isErr(result)).toBe(true);
    // No journal entry since we fell back to strict
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("lenient mode without journal still recovers via success trigger", async () => {
    const sessionRepo = new InMemoryWorkflowSessionRepository();
    const sliceRepo = new InMemorySliceRepository();
    const dateProvider = new StubDateProvider();
    const sliceTransitionPort = new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider);
    const eventBus = new InProcessEventBus(new SilentLoggerAdapter());
    const useCase = new OrchestratePhaseTransitionUseCase(
      sessionRepo,
      sliceTransitionPort,
      eventBus,
      dateProvider,
    );

    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withCurrentPhase("executing")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "executing");

    // "approve" is invalid for "executing"; lenient tries "next" (success trigger)
    const result = await useCase.execute({
      milestoneId: session.milestoneId as string,
      trigger: "approve",
      guardContext: { ...DEFAULT_GUARD_CTX, failurePolicy: "lenient" },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.fromPhase).toBe("executing");
      expect(result.data.toPhase).toBe("verifying");
    }
  });

  it("PHASE_SUCCESS_TRIGGERS covers all active workflow phases", () => {
    const activePhases = [
      "discussing",
      "researching",
      "planning",
      "executing",
      "verifying",
      "reviewing",
      "shipping",
    ];
    for (const phase of activePhases) {
      expect(PHASE_SUCCESS_TRIGGERS[phase]).toBeDefined();
    }
  });
});

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
import { OrchestratePhaseTransitionUseCase } from "./orchestrate-phase-transition.use-case";

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

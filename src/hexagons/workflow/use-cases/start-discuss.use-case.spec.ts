import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { InProcessEventBus, isErr, isOk, SilentLoggerAdapter } from "@kernel";
import { describe, expect, it } from "vitest";
import { WorkflowSession } from "../domain/workflow-session.aggregate";
import { WorkflowSessionBuilder } from "../domain/workflow-session.builder";
import { InMemoryWorkflowSessionRepository } from "../infrastructure/in-memory-workflow-session.repository";
import { StartDiscussUseCase } from "./start-discuss.use-case";

function setup(overrides?: { autonomyMode?: "guided" | "plan-to-pr" }) {
  const sliceRepo = new InMemorySliceRepository();
  const sessionRepo = new InMemoryWorkflowSessionRepository();
  const eventBus = new InProcessEventBus(new SilentLoggerAdapter());
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const autonomyModeProvider = {
    getAutonomyMode: () => overrides?.autonomyMode ?? ("plan-to-pr" as const),
  };

  const useCase = new StartDiscussUseCase(
    sliceRepo,
    sessionRepo,
    eventBus,
    dateProvider,
    autonomyModeProvider,
  );
  return { useCase, sliceRepo, sessionRepo, eventBus, dateProvider, fixedNow };
}

describe("StartDiscussUseCase", () => {
  it("should create a new session, assign slice, and transition to discussing", async () => {
    const { useCase, sliceRepo } = setup();
    const slice = new SliceBuilder().withId("a0000000-0000-1000-a000-000000000001").build();
    sliceRepo.seed(slice);

    const result = await useCase.execute({
      sliceId: "a0000000-0000-1000-a000-000000000001",
      milestoneId: "b0000000-0000-1000-a000-000000000001",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.fromPhase).toBe("idle");
      expect(result.data.toPhase).toBe("discussing");
      expect(result.data.autonomyMode).toBe("plan-to-pr");
    }
  });

  it("should reuse existing session for the milestone", async () => {
    const { useCase, sliceRepo, sessionRepo } = setup();
    const slice = new SliceBuilder().withId("a0000000-0000-1000-a000-000000000002").build();
    sliceRepo.seed(slice);
    const existingSession = WorkflowSession.createNew({
      id: "c0000000-0000-1000-a000-000000000001",
      milestoneId: "b0000000-0000-1000-a000-000000000001",
      autonomyMode: "plan-to-pr",
      now: new Date(),
    });
    sessionRepo.seed(existingSession);

    const result = await useCase.execute({
      sliceId: "a0000000-0000-1000-a000-000000000002",
      milestoneId: "b0000000-0000-1000-a000-000000000001",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data.sessionId).toBe("c0000000-0000-1000-a000-000000000001");
  });

  it("should return error if slice does not exist", async () => {
    const { useCase } = setup();
    const result = await useCase.execute({
      sliceId: "a0000000-0000-1000-a000-000000000099",
      milestoneId: "b0000000-0000-1000-a000-000000000001",
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("SLICE.NOT_FOUND");
  });

  it("should return SliceAlreadyAssignedError if session has active slice", async () => {
    const { useCase, sliceRepo, sessionRepo } = setup();
    const slice1 = new SliceBuilder().withId("a0000000-0000-1000-a000-000000000003").build();
    const slice2 = new SliceBuilder()
      .withId("a0000000-0000-1000-a000-000000000004")
      .withLabel("M01-S02")
      .build();
    sliceRepo.seed(slice1);
    sliceRepo.seed(slice2);
    const session = WorkflowSession.createNew({
      id: "c0000000-0000-1000-a000-000000000002",
      milestoneId: "b0000000-0000-1000-a000-000000000002",
      autonomyMode: "plan-to-pr",
      now: new Date(),
    });
    session.assignSlice("a0000000-0000-1000-a000-000000000003");
    sessionRepo.seed(session);

    const result = await useCase.execute({
      sliceId: "a0000000-0000-1000-a000-000000000004",
      milestoneId: "b0000000-0000-1000-a000-000000000002",
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("WORKFLOW.SLICE_ALREADY_ASSIGNED");
  });

  it("should return NoMatchingTransitionError if session not idle", async () => {
    const { useCase, sliceRepo, sessionRepo } = setup();
    const slice = new SliceBuilder().withId("a0000000-0000-1000-a000-000000000005").build();
    sliceRepo.seed(slice);
    const session = WorkflowSession.reconstitute(
      new WorkflowSessionBuilder()
        .withId("c0000000-0000-1000-a000-000000000003")
        .withMilestoneId("b0000000-0000-1000-a000-000000000003")
        .withCurrentPhase("discussing")
        .buildProps(),
    );
    sessionRepo.seed(session);

    const result = await useCase.execute({
      sliceId: "a0000000-0000-1000-a000-000000000005",
      milestoneId: "b0000000-0000-1000-a000-000000000003",
    });
    expect(isErr(result)).toBe(true);
  });
});

import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { WorkflowSessionBuilder } from "../domain/workflow-session.builder";
import { InMemoryWorkflowSessionRepository } from "../infrastructure/in-memory-workflow-session.repository";
import { SuggestNextStepUseCase } from "./suggest-next-step.use-case";

// NOTE: SliceBuilder.build() calls Slice.createNew() which hardcodes status="discussing".
// Use Slice.reconstitute(builder.buildProps()) when custom status/complexity is needed.

describe("SuggestNextStepUseCase", () => {
  const MS_ID = crypto.randomUUID();

  function setup() {
    const sessionRepo = new InMemoryWorkflowSessionRepository();
    const sliceRepo = new InMemorySliceRepository();
    const useCase = new SuggestNextStepUseCase(sessionRepo, sliceRepo);
    return { sessionRepo, sliceRepo, useCase };
  }

  it("returns suggestion for active session with slice", async () => {
    const { sessionRepo, sliceRepo, useCase } = setup();
    const msId = crypto.randomUUID();
    const slice = Slice.reconstitute(
      new SliceBuilder()
        .withLabel("M03-S08")
        .withMilestoneId(msId)
        .withStatus("researching")
        .buildProps(),
    );
    const session = new WorkflowSessionBuilder()
      .withMilestoneId(msId)
      .withSliceId(slice.id)
      .withCurrentPhase("researching")
      .withAutonomyMode("guided")
      .build();
    sliceRepo.seed(slice);
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: msId });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).not.toBeNull();
    expect(result.data?.command).toBe("/tff plan");
    expect(result.data?.displayText).toContain("M03-S08");
  });

  it("returns idle suggestion when session has no slice", async () => {
    const { sessionRepo, sliceRepo, useCase } = setup();
    const msId = crypto.randomUUID();
    const slice = new SliceBuilder().withMilestoneId(msId).build();
    const session = new WorkflowSessionBuilder()
      .withMilestoneId(msId)
      .withCurrentPhase("idle")
      .withAutonomyMode("guided")
      .build();
    sliceRepo.seed(slice);
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: msId });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data?.command).toBe("/tff discuss");
  });

  it("returns complete-milestone when allSlicesClosed", async () => {
    const { sessionRepo, sliceRepo, useCase } = setup();
    const msId = crypto.randomUUID();
    const slice = Slice.reconstitute(
      new SliceBuilder().withMilestoneId(msId).withStatus("closed").buildProps(),
    );
    const session = new WorkflowSessionBuilder()
      .withMilestoneId(msId)
      .withCurrentPhase("idle")
      .withAutonomyMode("guided")
      .build();
    sliceRepo.seed(slice);
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: msId });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data?.command).toBe("/tff complete-milestone");
  });

  it("returns null when no session and no slices", async () => {
    const { useCase } = setup();
    const result = await useCase.execute({ milestoneId: MS_ID });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toBeNull();
  });

  it("returns error when sliceId present but slice not found", async () => {
    const { sessionRepo, useCase } = setup();
    const msId = crypto.randomUUID();
    const session = new WorkflowSessionBuilder()
      .withMilestoneId(msId)
      .withSliceId(crypto.randomUUID())
      .withCurrentPhase("researching")
      .withAutonomyMode("guided")
      .build();
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: msId });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("SLICE.NOT_FOUND");
  });

  it("converts null complexity to undefined tier", async () => {
    const { sessionRepo, sliceRepo, useCase } = setup();
    const msId = crypto.randomUUID();
    const slice = new SliceBuilder().withLabel("M03-S08").withMilestoneId(msId).build();
    const session = new WorkflowSessionBuilder()
      .withMilestoneId(msId)
      .withSliceId(slice.id)
      .withCurrentPhase("discussing")
      .withAutonomyMode("guided")
      .build();
    sliceRepo.seed(slice);
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: msId });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // tier=undefined => S-tier guard does NOT fire => defaults to /tff research
    expect(result.data?.command).toBe("/tff research");
  });

  it("returns null for completing-milestone phase", async () => {
    const { sessionRepo, sliceRepo, useCase } = setup();
    const msId = crypto.randomUUID();
    const slice = Slice.reconstitute(
      new SliceBuilder().withMilestoneId(msId).withStatus("closed").buildProps(),
    );
    const session = new WorkflowSessionBuilder()
      .withMilestoneId(msId)
      .withCurrentPhase("completing-milestone")
      .withAutonomyMode("guided")
      .build();
    sliceRepo.seed(slice);
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: msId });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toBeNull();
  });
});

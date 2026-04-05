import { Milestone } from "@hexagons/milestone/domain/milestone.aggregate";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { Slice } from "../domain/slice.aggregate";
import { SliceBuilder } from "../domain/slice.builder";
import { InMemorySliceRepository } from "../infrastructure/in-memory-slice.repository";
import { AddSliceUseCase } from "./add-slice.use-case";

const MS_ID = "a0000000-0000-1000-a000-000000000001";
const PROJECT_ID = "b0000000-0000-1000-a000-000000000001";
const S1_ID = "c0000000-0000-1000-a000-000000000001";
const S2_ID = "c0000000-0000-1000-a000-000000000002";
const S3_ID = "c0000000-0000-1000-a000-000000000003";
const S5_ID = "c0000000-0000-1000-a000-000000000005";
const fixedNow = new Date("2026-04-05T12:00:00Z");
const dateProvider = { now: () => fixedNow };

function createInProgressMilestone(id = MS_ID, label = "M07"): Milestone {
  const ms = Milestone.createNew({
    id,
    projectId: PROJECT_ID,
    label,
    title: "Test Milestone",
    now: new Date("2026-04-01T00:00:00Z"),
  });
  ms.activate(new Date("2026-04-01T00:00:00Z"));
  return ms;
}

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const milestoneRepo = new InMemoryMilestoneRepository();
  const useCase = new AddSliceUseCase(sliceRepo, milestoneRepo, dateProvider);
  return { sliceRepo, milestoneRepo, useCase };
}

describe("AddSliceUseCase", () => {
  it("adds slice at end of milestone (position = max + 1)", async () => {
    const { sliceRepo, milestoneRepo, useCase } = setup();
    milestoneRepo.seed(createInProgressMilestone());

    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S1_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S01")
          .withPosition(0)
          .buildProps(),
      ),
    );
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S2_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S02")
          .withPosition(1)
          .buildProps(),
      ),
    );

    const result = await useCase.execute({ milestoneId: MS_ID, title: "New Slice" });

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.data.position).toBe(2);
    expect(result.data.sliceLabel).toBe("M07-S03");
  });

  it("inserts after specified label and shifts downstream", async () => {
    const { sliceRepo, milestoneRepo, useCase } = setup();
    milestoneRepo.seed(createInProgressMilestone());

    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S1_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S01")
          .withPosition(0)
          .buildProps(),
      ),
    );
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S2_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S02")
          .withPosition(1)
          .buildProps(),
      ),
    );
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S3_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S03")
          .withPosition(2)
          .buildProps(),
      ),
    );

    const result = await useCase.execute({
      milestoneId: MS_ID,
      title: "Inserted Slice",
      afterLabel: "M07-S01",
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.data.position).toBe(1);
    expect(result.data.sliceLabel).toBe("M07-S04");

    // Verify downstream shifted
    const s2After = await sliceRepo.findById(S2_ID);
    expect(s2After.ok && s2After.data?.position).toBe(2);

    const s3After = await sliceRepo.findById(S3_ID);
    expect(s3After.ok && s3After.data?.position).toBe(3);

    // S01 should be unchanged
    const s1After = await sliceRepo.findById(S1_ID);
    expect(s1After.ok && s1After.data?.position).toBe(0);
  });

  it("rejects when milestone is not in_progress", async () => {
    const { milestoneRepo, useCase } = setup();
    const ms = Milestone.createNew({
      id: MS_ID,
      projectId: PROJECT_ID,
      label: "M07",
      title: "Test",
      now: new Date(),
    });
    milestoneRepo.seed(ms);

    const result = await useCase.execute({ milestoneId: MS_ID, title: "Fail" });

    expect(isErr(result)).toBe(true);
    if (result.ok) return;
    expect(result.error.message).toContain("in_progress");
  });

  it("rejects when milestone not found", async () => {
    const { useCase } = setup();

    const result = await useCase.execute({
      milestoneId: "d0000000-0000-1000-a000-000000000099",
      title: "Fail",
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) return;
    expect(result.error.message).toContain("Milestone not found");
  });

  it("auto-generates correct label suffix", async () => {
    const { sliceRepo, milestoneRepo, useCase } = setup();
    milestoneRepo.seed(createInProgressMilestone());

    // Seed slices with gaps: S01, S05
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S1_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S01")
          .withPosition(0)
          .buildProps(),
      ),
    );
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S5_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S05")
          .withPosition(1)
          .buildProps(),
      ),
    );

    const result = await useCase.execute({ milestoneId: MS_ID, title: "After Gap" });

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    // max suffix is 5, so next is S06
    expect(result.data.sliceLabel).toBe("M07-S06");
  });

  it("rejects when afterLabel not found", async () => {
    const { milestoneRepo, useCase } = setup();
    milestoneRepo.seed(createInProgressMilestone());

    const result = await useCase.execute({
      milestoneId: MS_ID,
      title: "Fail",
      afterLabel: "M07-S99",
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) return;
    expect(result.error.message).toContain("Slice not found: M07-S99");
  });

  it("adds first slice at position 0 for empty milestone", async () => {
    const { milestoneRepo, useCase } = setup();
    milestoneRepo.seed(createInProgressMilestone());

    const result = await useCase.execute({ milestoneId: MS_ID, title: "First Slice" });

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.data.position).toBe(0);
    expect(result.data.sliceLabel).toBe("M07-S01");
  });
});

import { faker } from "@faker-js/faker";
import { Milestone } from "@hexagons/milestone/domain/milestone.aggregate";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { DateProviderPort, isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { MilestoneTransitionError } from "../../../domain/errors/milestone-transition.error";
import { MilestoneTransitionAdapter } from "./milestone-transition.adapter";

class StubDateProvider extends DateProviderPort {
  private _now = new Date("2026-04-01T00:00:00Z");
  now(): Date {
    return this._now;
  }
}

function setup() {
  const milestoneRepo = new InMemoryMilestoneRepository();
  const dateProvider = new StubDateProvider();
  const adapter = new MilestoneTransitionAdapter(milestoneRepo, dateProvider);
  return { adapter, milestoneRepo, dateProvider };
}

function seedInProgressMilestone(repo: InMemoryMilestoneRepository): Milestone {
  const now = new Date("2026-03-01T00:00:00Z");
  const milestone = Milestone.createNew({
    id: faker.string.uuid(),
    projectId: faker.string.uuid(),
    label: `M${faker.number.int({ min: 1, max: 99 }).toString().padStart(2, "0")}`,
    title: "Test Milestone",
    now,
  });
  milestone.activate(now);
  repo.seed(milestone);
  return milestone;
}

function seedOpenMilestone(repo: InMemoryMilestoneRepository): Milestone {
  const now = new Date("2026-03-01T00:00:00Z");
  const milestone = Milestone.createNew({
    id: faker.string.uuid(),
    projectId: faker.string.uuid(),
    label: `M${faker.number.int({ min: 1, max: 99 }).toString().padStart(2, "0")}`,
    title: "Open Milestone",
    now,
  });
  repo.seed(milestone);
  return milestone;
}

describe("MilestoneTransitionAdapter", () => {
  it("closes an in_progress milestone successfully", async () => {
    const { adapter, milestoneRepo } = setup();
    const milestone = seedInProgressMilestone(milestoneRepo);

    const result = await adapter.close(milestone.id);

    expect(isOk(result)).toBe(true);
    const reloaded = await milestoneRepo.findById(milestone.id);
    if (isOk(reloaded) && reloaded.data) {
      expect(reloaded.data.status).toBe("closed");
    }
  });

  it("returns MilestoneTransitionError.notFound when milestone does not exist", async () => {
    const { adapter } = setup();

    const result = await adapter.close(faker.string.uuid());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(MilestoneTransitionError);
      expect(result.error.code).toBe("MILESTONE_TRANSITION.NOT_FOUND");
    }
  });

  it("returns MilestoneTransitionError.invalidTransition when milestone is open", async () => {
    const { adapter, milestoneRepo } = setup();
    const milestone = seedOpenMilestone(milestoneRepo);

    const result = await adapter.close(milestone.id);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(MilestoneTransitionError);
      expect(result.error.code).toBe("MILESTONE_TRANSITION.INVALID_TRANSITION");
    }
  });
});

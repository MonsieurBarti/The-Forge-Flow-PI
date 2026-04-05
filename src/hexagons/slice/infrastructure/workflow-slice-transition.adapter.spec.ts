import { faker } from "@faker-js/faker";
import { SliceTransitionError } from "@hexagons/workflow/domain/errors/slice-transition.error";
import { DateProviderPort, isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { Slice } from "../domain/slice.aggregate";
import type { SliceStatus } from "../domain/slice.schemas";
import { InMemorySliceRepository } from "./in-memory-slice.repository";
import { WorkflowSliceTransitionAdapter } from "./workflow-slice-transition.adapter";

class StubDateProvider extends DateProviderPort {
  private _now = new Date("2026-01-15T10:00:00Z");
  now(): Date {
    return this._now;
  }
}

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const dateProvider = new StubDateProvider();
  const adapter = new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider);
  return { adapter, sliceRepo, dateProvider };
}

function seedSlice(
  repo: InMemorySliceRepository,
  overrides: { id?: string; status?: SliceStatus } = {},
): Slice {
  const slice = Slice.reconstitute({
    id: overrides.id ?? faker.string.uuid(),
    milestoneId: faker.string.uuid(),
    kind: "milestone" as const,
    label: "M01-S01",
    title: "Test Slice",
    description: "",
    status: overrides.status ?? "discussing",
    complexity: null,
    specPath: null,
    planPath: null,
    researchPath: null,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  repo.seed(slice);
  return slice;
}

describe("WorkflowSliceTransitionAdapter", () => {
  it("transitions slice to target status", async () => {
    const { adapter, sliceRepo } = setup();
    const slice = seedSlice(sliceRepo, { status: "discussing" });

    const result = await adapter.transition(slice.id, "researching");

    expect(isOk(result)).toBe(true);
    const reloaded = await sliceRepo.findById(slice.id);
    if (isOk(reloaded) && reloaded.data) {
      expect(reloaded.data.status).toBe("researching");
    }
  });

  it("returns ok on idempotent transition (current == target)", async () => {
    const { adapter, sliceRepo } = setup();
    const slice = seedSlice(sliceRepo, { status: "executing" });

    const result = await adapter.transition(slice.id, "executing");

    expect(isOk(result)).toBe(true);
    const reloaded = await sliceRepo.findById(slice.id);
    if (isOk(reloaded) && reloaded.data) {
      expect(reloaded.data.status).toBe("executing");
    }
  });

  it("returns SliceTransitionError when slice not found", async () => {
    const { adapter } = setup();

    const result = await adapter.transition(faker.string.uuid(), "researching");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(SliceTransitionError);
      expect(result.error.code).toBe("SLICE_TRANSITION_FAILED");
    }
  });

  it("returns SliceTransitionError on invalid transition", async () => {
    const { adapter, sliceRepo } = setup();
    const slice = seedSlice(sliceRepo, { status: "discussing" });

    const result = await adapter.transition(slice.id, "executing");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(SliceTransitionError);
    }
  });
});

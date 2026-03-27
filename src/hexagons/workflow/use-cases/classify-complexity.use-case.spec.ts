import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { ClassifyComplexityUseCase } from "./classify-complexity.use-case";

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const useCase = new ClassifyComplexityUseCase(sliceRepo, dateProvider);
  return { useCase, sliceRepo, dateProvider, fixedNow };
}

describe("ClassifyComplexityUseCase", () => {
  it("should set complexity tier on slice", async () => {
    const { useCase, sliceRepo } = setup();
    const slice = new SliceBuilder().withId("a0000000-0000-4000-a000-000000000001").build();
    sliceRepo.seed(slice);

    const result = await useCase.execute({
      sliceId: "a0000000-0000-4000-a000-000000000001",
      tier: "F-lite",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.sliceId).toBe("a0000000-0000-4000-a000-000000000001");
      expect(result.data.tier).toBe("F-lite");
    }

    const updated = await sliceRepo.findById("a0000000-0000-4000-a000-000000000001");
    if (isOk(updated) && updated.data) {
      expect(updated.data.complexity).toBe("F-lite");
    }
  });

  it("should return SliceNotFoundError if slice not found", async () => {
    const { useCase } = setup();
    const result = await useCase.execute({
      sliceId: "a0000000-0000-4000-a000-000000000099",
      tier: "S",
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("SLICE.NOT_FOUND");
  });
});

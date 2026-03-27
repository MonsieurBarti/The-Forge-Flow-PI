import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { err, isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";

import { FileIOError } from "../domain/errors/file-io.error";
import { ArtifactFilePort } from "../domain/ports/artifact-file.port";
import { InMemoryArtifactFileAdapter } from "../infrastructure/in-memory-artifact-file.adapter";
import { WriteResearchUseCase } from "./write-research.use-case";

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const artifactFile = new InMemoryArtifactFileAdapter();
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const useCase = new WriteResearchUseCase(artifactFile, sliceRepo, dateProvider);
  return { useCase, sliceRepo, artifactFile, dateProvider, fixedNow };
}

describe("WriteResearchUseCase", () => {
  it("should write RESEARCH.md and update slice researchPath", async () => {
    const { useCase, sliceRepo, artifactFile } = setup();
    const sliceId = crypto.randomUUID();
    const slice = new SliceBuilder().withId(sliceId).build();
    sliceRepo.seed(slice);

    const result = await useCase.execute({
      milestoneLabel: "M03",
      sliceLabel: "M03-S06",
      sliceId,
      content: "# Research Findings",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data.path).toContain("RESEARCH.md");

    // Verify file was written
    const readResult = await artifactFile.read("M03", "M03-S06", "research");
    if (isOk(readResult)) expect(readResult.data).toBe("# Research Findings");

    // Verify slice researchPath updated
    const updated = await sliceRepo.findById(sliceId);
    if (isOk(updated) && updated.data) expect(updated.data.researchPath).toContain("RESEARCH.md");
  });

  it("should return FileIOError when write fails", async () => {
    const { sliceRepo, dateProvider } = setup();
    const sliceId = crypto.randomUUID();
    const slice = new SliceBuilder().withId(sliceId).build();
    sliceRepo.seed(slice);

    // Create a failing adapter using Object.assign on the prototype (mirrors write-spec pattern)
    const failingAdapter = Object.assign(Object.create(ArtifactFilePort.prototype), {
      write: async () => err(new FileIOError("Disk full")),
      read: async () => err(new FileIOError("Disk full")),
    });
    const failUseCase = new WriteResearchUseCase(failingAdapter, sliceRepo, dateProvider);

    const result = await failUseCase.execute({
      milestoneLabel: "M03",
      sliceLabel: "M03-S06",
      sliceId,
      content: "# Research",
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("WORKFLOW.FILE_IO");
  });

  it("should return SliceNotFoundError when slice missing", async () => {
    const { useCase } = setup();
    const result = await useCase.execute({
      milestoneLabel: "M03",
      sliceLabel: "M03-S06",
      sliceId: crypto.randomUUID(),
      content: "# Research",
    });
    expect(isErr(result)).toBe(true);
  });
});

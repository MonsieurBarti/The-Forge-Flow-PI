import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { err, isErr, isOk, ok } from "@kernel";
import { describe, expect, it } from "vitest";

import { FileIOError } from "../domain/errors/file-io.error";
import { ArtifactFilePort } from "../domain/ports/artifact-file.port";
import { InMemoryArtifactFileAdapter } from "../infrastructure/in-memory-artifact-file.adapter";
import { WriteSpecUseCase } from "./write-spec.use-case";

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const artifactFile = new InMemoryArtifactFileAdapter();
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const useCase = new WriteSpecUseCase(artifactFile, sliceRepo, dateProvider);
  return { useCase, sliceRepo, artifactFile, dateProvider, fixedNow };
}

describe("WriteSpecUseCase", () => {
  it("should write SPEC.md and update slice specPath", async () => {
    const { useCase, sliceRepo, artifactFile } = setup();
    const sliceId = crypto.randomUUID();
    const slice = new SliceBuilder().withId(sliceId).build();
    sliceRepo.seed(slice);

    const result = await useCase.execute({
      milestoneLabel: "M03",
      sliceLabel: "M03-S05",
      sliceId,
      content: "# My Spec",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data.path).toContain("SPEC.md");

    // Verify file was written
    const readResult = await artifactFile.read("M03", "M03-S05", "spec");
    if (isOk(readResult)) expect(readResult.data).toBe("# My Spec");

    // Verify slice specPath updated
    const updated = await sliceRepo.findById(sliceId);
    if (isOk(updated) && updated.data) expect(updated.data.specPath).toContain("SPEC.md");
  });

  it("should return FileIOError when write fails", async () => {
    const { sliceRepo, dateProvider } = setup();
    // Create a failing adapter
    const failingAdapter = Object.assign(Object.create(ArtifactFilePort.prototype), {
      write: async () => err(new FileIOError("Disk full")),
      read: async () => ok(null),
    });
    const failUseCase = new WriteSpecUseCase(failingAdapter, sliceRepo, dateProvider);
    const sliceId = crypto.randomUUID();
    const slice = new SliceBuilder().withId(sliceId).build();
    sliceRepo.seed(slice);

    const result = await failUseCase.execute({
      milestoneLabel: "M03",
      sliceLabel: "M03-S05",
      sliceId,
      content: "# Spec",
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("WORKFLOW.FILE_IO");
  });

  it("should return SliceNotFoundError when slice missing", async () => {
    const { useCase } = setup();
    const result = await useCase.execute({
      milestoneLabel: "M03",
      sliceLabel: "M03-S05",
      sliceId: crypto.randomUUID(),
      content: "# Spec",
    });
    expect(isErr(result)).toBe(true);
  });
});

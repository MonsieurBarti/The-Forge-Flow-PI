import { InMemoryReviewUIAdapter } from "@hexagons/review";
import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { createMockExtensionContext } from "@infrastructure/pi/testing";
import { describe, expect, it } from "vitest";
import { InMemoryArtifactFileAdapter } from "../../infrastructure/in-memory-artifact-file.adapter";
import { WriteResearchUseCase } from "../../use-cases/write-research.use-case";
import { createWriteResearchTool } from "./write-research.tool";

const mockCtx = createMockExtensionContext();

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const artifactFile = new InMemoryArtifactFileAdapter();
  const reviewUI = new InMemoryReviewUIAdapter();
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const useCase = new WriteResearchUseCase(artifactFile, sliceRepo, dateProvider);
  const tool = createWriteResearchTool(useCase, reviewUI);
  return { tool, sliceRepo, artifactFile };
}

describe("tff_write_research tool", () => {
  it("should have correct name", () => {
    const { tool } = setup();
    expect(tool.name).toBe("tff_write_research");
  });

  it("should write research and return ok result", async () => {
    const { tool, sliceRepo } = setup();
    const sliceId = crypto.randomUUID();
    const slice = Slice.reconstitute(
      new SliceBuilder().withId(sliceId).withStatus("researching").buildProps(),
    );
    sliceRepo.seed(slice);

    const result = await tool.execute(
      "call-1",
      { milestoneLabel: "M03", sliceLabel: "M03-S06", sliceId, content: "# Research" },
      undefined,
      undefined,
      mockCtx,
    );

    const block = result.content[0];
    const text = block.type === "text" ? block.text : "";
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.path).toContain("RESEARCH.md");
  });

  it("should return error for invalid UUID", async () => {
    const { tool } = setup();

    const result = await tool.execute(
      "call-2",
      { milestoneLabel: "M03", sliceLabel: "M03-S06", sliceId: "not-uuid", content: "# R" },
      undefined,
      undefined,
      mockCtx,
    );

    const block = result.content[0];
    const text = block.type === "text" ? block.text : "";
    expect(text).toContain("Validation error");
  });
});

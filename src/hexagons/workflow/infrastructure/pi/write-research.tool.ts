import { MilestoneLabelSchema } from "@hexagons/milestone";
import { SliceLabelSchema } from "@hexagons/slice";
import { createZodTool, textResult } from "@infrastructure/pi";
import { IdSchema, isErr } from "@kernel";
import { z } from "zod";
import type { WriteResearchUseCase } from "../../use-cases/write-research.use-case";

const WriteResearchSchema = z.object({
  milestoneLabel: MilestoneLabelSchema.describe("Milestone label, e.g. M03"),
  sliceLabel: SliceLabelSchema.describe("Slice label, e.g. M03-S06"),
  sliceId: IdSchema.describe("Slice UUID"),
  content: z.string().describe("Markdown research content"),
});

export function createWriteResearchTool(useCase: WriteResearchUseCase) {
  return createZodTool({
    name: "tff_write_research",
    label: "TFF Write Research",
    description: "Write RESEARCH.md for a slice and update the slice aggregate.",
    schema: WriteResearchSchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify({ ok: true, path: result.data.path }));
    },
  });
}

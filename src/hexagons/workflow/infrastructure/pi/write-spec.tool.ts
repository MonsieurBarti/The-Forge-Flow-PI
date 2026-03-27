import { MilestoneLabelSchema } from "@hexagons/milestone";
import { SliceLabelSchema } from "@hexagons/slice";
import { createZodTool, textResult } from "@infrastructure/pi";
import { isErr } from "@kernel";
import { z } from "zod";
import type { WriteSpecUseCase } from "../../use-cases/write-spec.use-case";

const WriteSpecSchema = z.object({
  milestoneLabel: MilestoneLabelSchema.describe("Milestone label, e.g. M03"),
  sliceLabel: SliceLabelSchema.describe("Slice label, e.g. M03-S05"),
  sliceId: z.string().describe("Slice UUID"),
  content: z.string().describe("Markdown spec content"),
});

export function createWriteSpecTool(useCase: WriteSpecUseCase) {
  return createZodTool({
    name: "tff_write_spec",
    label: "TFF Write Spec",
    description: "Write SPEC.md for a slice and update the slice aggregate.",
    schema: WriteSpecSchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify({ ok: true, path: result.data.path }));
    },
  });
}

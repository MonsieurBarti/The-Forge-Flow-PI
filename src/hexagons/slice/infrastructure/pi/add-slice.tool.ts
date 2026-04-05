import { createZodTool, textResult } from "@infrastructure/pi";
import { z } from "zod";
import type { AddSliceUseCase } from "../../application/add-slice.use-case";

export interface AddSliceToolDeps {
  addSlice: AddSliceUseCase;
}

export function createAddSliceTool(deps: AddSliceToolDeps) {
  return createZodTool({
    name: "tff_add_slice",
    label: "TFF Add Slice",
    description: "Add a new slice to a milestone with optional positional insertion",
    schema: z.object({
      milestoneId: z.string().describe("Milestone ID to add slice to"),
      title: z.string().describe("Slice title"),
      description: z.string().optional().describe("Slice description"),
      afterLabel: z.string().optional().describe("Insert after this slice label"),
    }),
    execute: async (params) => {
      const result = await deps.addSlice.execute(params);
      if (!result.ok) return textResult(JSON.stringify({ error: result.error.message }));
      return textResult(JSON.stringify(result.data));
    },
  });
}

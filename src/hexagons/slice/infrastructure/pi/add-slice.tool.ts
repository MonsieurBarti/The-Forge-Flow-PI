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
    description:
      "Add a new slice to the active The Forge Flow (TFF) milestone. Auto-assigns the next label (M01-S01, M01-S02, ...). Use a descriptive title — NOT the label. IMPORTANT: Call this tool ONE AT A TIME — wait for each call to complete before creating the next slice.",
    schema: z.object({
      milestoneId: z.string().describe("Milestone ID (from tff_status output)"),
      title: z.string().describe("Slice title"),
      description: z.string().optional().describe("Slice description"),
      afterLabel: z.string().optional().describe("Insert after this slice label"),
    }),
    execute: async (params) => {
      const result = await deps.addSlice.execute(params);
      if (!result.ok) return textResult(JSON.stringify({ error: result.error.message }));
      return textResult(
        `Added slice **${result.data.sliceLabel}**: "${params.title}" at position ${result.data.position}`,
      );
    },
  });
}

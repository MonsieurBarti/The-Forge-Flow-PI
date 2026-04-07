import { ComplexityTierSchema } from "@hexagons/slice";
import { createZodTool, textResult } from "@infrastructure/pi";
import { isErr } from "@kernel";
import { z } from "zod";
import type { QuickStartUseCase } from "../../use-cases/quick-start.use-case";

const QuickStartToolSchema = z.object({
  title: z.string().describe("Title for the quick slice"),
  description: z.string().optional().describe("Description"),
  complexity: ComplexityTierSchema.optional().describe("Complexity tier (default S)"),
});

export interface QuickStartToolDeps {
  quickStart: QuickStartUseCase;
  tffDir: string;
}

export function createQuickStartTool(deps: QuickStartToolDeps) {
  return createZodTool({
    name: "tff_quick_start",
    label: "TFF Quick Start",
    description:
      "The Forge Flow (TFF) — create an ad-hoc quick slice, skipping discuss and research phases",
    schema: QuickStartToolSchema,
    execute: async (params) => {
      const result = await deps.quickStart.execute({
        title: params.title,
        description: params.description ?? params.title,
        complexity: params.complexity,
        tffDir: deps.tffDir,
      });
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify(result.data));
    },
  });
}

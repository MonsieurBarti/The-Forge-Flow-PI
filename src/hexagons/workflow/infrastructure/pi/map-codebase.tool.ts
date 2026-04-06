import { createZodTool, textResult } from "@infrastructure/pi";
import { z } from "zod";
import type { MapCodebaseUseCase } from "../../application/map-codebase.use-case";

export interface MapCodebaseToolDeps {
  mapCodebase: MapCodebaseUseCase;
}

export function createMapCodebaseTool(deps: MapCodebaseToolDeps) {
  return createZodTool({
    name: "tff_map_codebase",
    label: "TFF Map Codebase",
    description: "Generate or update codebase documentation (.tff/docs/)",
    schema: z.object({
      tffDir: z.string().describe("Path to .tff directory"),
      workingDirectory: z.string().describe("Project root directory"),
      mode: z.enum(["full", "incremental"]).optional().describe("Generation mode"),
      baseBranch: z.string().optional().describe("Base branch for incremental diff"),
    }),
    execute: async (params) => {
      const result = await deps.mapCodebase.execute({
        tffDir: params.tffDir,
        workingDirectory: params.workingDirectory,
        mode: params.mode ?? "full",
        baseBranch: params.baseBranch,
      });
      if (!result.ok) return textResult(JSON.stringify({ error: result.error.message }));
      return textResult(JSON.stringify(result.data));
    },
  });
}

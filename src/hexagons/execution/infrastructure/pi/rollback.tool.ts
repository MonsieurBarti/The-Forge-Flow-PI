import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import { createZodTool, textResult } from "@infrastructure/pi";
import { z } from "zod";
import type { RollbackSliceUseCase } from "../../application/rollback-slice.use-case";
import type { CheckpointRepositoryPort } from "../../domain/ports/checkpoint-repository.port";

export interface RollbackToolDeps {
  rollback: RollbackSliceUseCase;
  checkpointRepo: CheckpointRepositoryPort;
  sliceRepo: SliceRepositoryPort;
}

export function createRollbackTool(deps: RollbackToolDeps) {
  return createZodTool({
    name: "tff_rollback",
    label: "TFF Rollback Slice",
    description: "Revert execution commits for a slice and return it to planning phase",
    schema: z.object({
      sliceLabel: z.string().describe("Label of the slice to rollback"),
      baseCommit: z
        .string()
        .optional()
        .describe("Base commit hash (auto-discovered from checkpoint if omitted)"),
    }),
    execute: async (params) => {
      // Find slice
      const sliceResult = await deps.sliceRepo.findByLabel(params.sliceLabel);
      if (!sliceResult.ok || !sliceResult.data) {
        return textResult(JSON.stringify({ error: `Slice not found: ${params.sliceLabel}` }));
      }
      const slice = sliceResult.data;

      // Discover baseCommit
      let baseCommit = params.baseCommit;
      if (!baseCommit) {
        const cpResult = await deps.checkpointRepo.findBySliceId(slice.id);
        if (cpResult.ok && cpResult.data) {
          baseCommit = cpResult.data.baseCommit;
        } else {
          return textResult(JSON.stringify({ error: "No checkpoint found. Provide baseCommit." }));
        }
      }

      const result = await deps.rollback.execute({ sliceId: slice.id, baseCommit });
      if (!result.ok) return textResult(JSON.stringify({ error: result.error.message }));
      return textResult(JSON.stringify(result.data));
    },
  });
}

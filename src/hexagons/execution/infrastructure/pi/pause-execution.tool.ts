import { createZodTool, textResult } from "@infrastructure/pi";
import { IdSchema, isErr } from "@kernel";
import { z } from "zod";
import type { ExecutionCoordinator } from "../../application/execution-coordinator.use-case";

const PauseExecutionSchema = z.object({
  sliceId: IdSchema.describe("Slice ID to pause"),
});

export function createPauseExecutionTool(coordinator: ExecutionCoordinator) {
  return createZodTool({
    name: "tff_pause_execution",
    label: "TFF Pause Execution",
    description: "Pause execution — reconcile state after interruption.",
    schema: PauseExecutionSchema,
    execute: async (params) => {
      const result = await coordinator.pauseExecution(params.sliceId);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify(result.data));
    },
  });
}

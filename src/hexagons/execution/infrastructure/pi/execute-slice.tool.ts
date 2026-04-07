import { createZodTool, textResult } from "@infrastructure/pi";
import {
  ComplexityTierSchema,
  IdSchema,
  isErr,
  ModelProfileNameSchema,
  ResolvedModelSchema,
} from "@kernel";
import { z } from "zod";
import type { ExecutionCoordinator } from "../../application/execution-coordinator.use-case";

const ExecuteSliceSchema = z.object({
  sliceId: IdSchema.describe("Slice ID (from tff_status output)"),
  milestoneId: IdSchema.describe("Milestone ID (from tff_status output)"),
  sliceLabel: z.string().min(1).describe("Slice label"),
  sliceTitle: z.string().min(1).describe("Slice title"),
  complexity: ComplexityTierSchema.describe("Complexity tier: S, F-lite, F-full"),
  model: ResolvedModelSchema.describe("Model configuration"),
  modelProfile: ModelProfileNameSchema.describe("Model profile name"),
  workingDirectory: z.string().min(1).describe("Worktree path"),
});

export function createExecuteSliceTool(coordinator: ExecutionCoordinator) {
  return createZodTool({
    name: "tff_execute_slice",
    label: "TFF Execute Slice",
    description: "Start wave-based task execution for a slice.",
    schema: ExecuteSliceSchema,
    execute: async (params) => {
      const result = await coordinator.startExecution(params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify(result.data));
    },
  });
}

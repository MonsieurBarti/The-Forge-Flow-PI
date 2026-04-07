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

const ResumeExecutionSchema = z.object({
  sliceId: IdSchema.describe("Slice ID to resume (from tff_status output)"),
  milestoneId: IdSchema.describe("Milestone ID (from tff_status output)"),
  sliceLabel: z.string().min(1).describe("Slice label"),
  sliceTitle: z.string().min(1).describe("Slice title"),
  complexity: ComplexityTierSchema.describe("Complexity tier"),
  model: ResolvedModelSchema.describe("Model configuration"),
  modelProfile: ModelProfileNameSchema.describe("Model profile name"),
  workingDirectory: z.string().min(1).describe("Worktree path"),
});

export function createResumeExecutionTool(coordinator: ExecutionCoordinator) {
  return createZodTool({
    name: "tff_resume_execution",
    label: "TFF Resume Execution",
    description: "Resume execution from saved checkpoint.",
    schema: ResumeExecutionSchema,
    execute: async (params) => {
      const result = await coordinator.resumeExecution(params.sliceId, params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify(result.data));
    },
  });
}

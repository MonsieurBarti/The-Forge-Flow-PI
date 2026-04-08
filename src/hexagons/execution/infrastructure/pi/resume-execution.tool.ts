import { dirname } from "node:path";
import { createZodTool, textResult } from "@infrastructure/pi";
import {
  type ComplexityTier,
  ComplexityTierSchema,
  IdSchema,
  isErr,
  type ModelProfileName,
  type ResolvedModel,
} from "@kernel";
import type { WorktreePort } from "@kernel/ports/worktree.port";
import { z } from "zod";
import type { ExecutionCoordinator } from "../../application/execution-coordinator.use-case";

const COMPLEXITY_TO_PROFILE: Record<ComplexityTier, ModelProfileName> = {
  S: "budget",
  "F-lite": "balanced",
  "F-full": "quality",
};

const ResumeExecutionSchema = z.object({
  sliceId: IdSchema.describe("Slice ID to resume (from tff_status output)"),
  milestoneId: IdSchema.describe("Milestone ID (from tff_status output)"),
  sliceLabel: z.string().min(1).describe("Slice label"),
  sliceTitle: z.string().min(1).describe("Slice title"),
  complexity: ComplexityTierSchema.describe("Complexity tier"),
});

export interface ResumeExecutionToolDeps {
  coordinator: ExecutionCoordinator;
  worktreeAdapter: WorktreePort;
  modelResolver: (profileName: string) => ResolvedModel;
}

export function createResumeExecutionTool(deps: ResumeExecutionToolDeps) {
  return createZodTool({
    name: "tff_resume_execution",
    label: "TFF Resume Execution",
    description:
      "Resume execution from saved checkpoint. Model and worktree path are auto-resolved.",
    schema: ResumeExecutionSchema,
    execute: async (params) => {
      const worktreePath = dirname(deps.worktreeAdapter.resolveTffDir(params.sliceId));
      const modelProfile = COMPLEXITY_TO_PROFILE[params.complexity];
      const model = deps.modelResolver(modelProfile);

      const result = await deps.coordinator.resumeExecution(params.sliceId, {
        ...params,
        model,
        modelProfile,
        workingDirectory: worktreePath,
      });
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify(result.data));
    },
  });
}

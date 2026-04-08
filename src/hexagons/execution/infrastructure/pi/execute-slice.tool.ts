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

const ExecuteSliceSchema = z.object({
  sliceId: IdSchema.describe("Slice ID (from tff_status output)"),
  milestoneId: IdSchema.describe("Milestone ID (from tff_status output)"),
  sliceLabel: z.string().min(1).describe("Slice label"),
  sliceTitle: z.string().min(1).describe("Slice title"),
  complexity: ComplexityTierSchema.describe("Complexity tier: S, F-lite, F-full"),
});

export interface ExecuteSliceToolDeps {
  coordinator: ExecutionCoordinator;
  worktreeAdapter: WorktreePort;
  modelResolver: (profileName: string) => ResolvedModel;
}

export function createExecuteSliceTool(deps: ExecuteSliceToolDeps) {
  return createZodTool({
    name: "tff_execute_slice",
    label: "TFF Execute Slice",
    description:
      "Start wave-based task execution for a slice. Model and worktree path are auto-resolved.",
    schema: ExecuteSliceSchema,
    execute: async (params) => {
      const worktreePath = dirname(deps.worktreeAdapter.resolveTffDir(params.sliceId));
      const modelProfile = COMPLEXITY_TO_PROFILE[params.complexity];
      const model = deps.modelResolver(modelProfile);

      const result = await deps.coordinator.startExecution({
        ...params,
        model,
        modelProfile,
        workingDirectory: worktreePath,
      });
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);

      const data = result.data;
      const nextSteps =
        data.status === "completed"
          ? "Execution complete. Present the results to the user and suggest /tff verify as the next step."
          : data.status === "paused"
            ? "Execution paused. Present the status to the user and suggest /tff resume or /tff rollback."
            : "Execution failed. Present the errors to the user and suggest retrying or /tff rollback.";

      if (data.failedTasks.length > 0 && data.taskErrors) {
        const failureDetails = data.failedTasks.map((id) => ({
          taskId: id,
          reason: data.taskErrors?.[id] ?? "unknown",
        }));
        return textResult(JSON.stringify({ ...data, failureDetails, nextSteps }));
      }

      return textResult(JSON.stringify({ ...data, nextSteps }));
    },
  });
}

import { dirname } from "node:path";
import { createZodTool, textResult } from "@infrastructure/pi";
import {
  ComplexityTierSchema,
  IdSchema,
  isErr,
  ModelProfileNameSchema,
  ResolvedModelSchema,
} from "@kernel";
import type { WorktreePort } from "@kernel/ports/worktree.port";
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
});

export interface ExecuteSliceToolDeps {
  coordinator: ExecutionCoordinator;
  worktreeAdapter: WorktreePort;
}

export function createExecuteSliceTool(deps: ExecuteSliceToolDeps) {
  return createZodTool({
    name: "tff_execute_slice",
    label: "TFF Execute Slice",
    description:
      "Start wave-based task execution for a slice. The worktree path is auto-resolved from the slice ID.",
    schema: ExecuteSliceSchema,
    execute: async (params) => {
      // Auto-resolve worktree path from slice ID
      const worktreePath = dirname(deps.worktreeAdapter.resolveTffDir(params.sliceId));

      const result = await deps.coordinator.startExecution({
        ...params,
        workingDirectory: worktreePath,
      });
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);

      // Include per-task failure details if any tasks failed
      const data = result.data;
      if (data.failedTasks.length > 0 && data.taskErrors) {
        const failureDetails = data.failedTasks.map((id) => ({
          taskId: id,
          reason: data.taskErrors?.[id] ?? "unknown",
        }));
        return textResult(JSON.stringify({ ...data, failureDetails }));
      }

      return textResult(JSON.stringify(data));
    },
  });
}

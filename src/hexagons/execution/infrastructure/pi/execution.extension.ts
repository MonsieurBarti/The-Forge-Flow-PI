import { dirname } from "node:path";
import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import { type ComplexityTier, isErr, type ModelProfileName, type ResolvedModel } from "@kernel";
import type { WorktreePort } from "@kernel/ports/worktree.port";
import type { TffDispatcher } from "../../../../cli/tff-dispatcher";
import {
  ExecutionCoordinator,
  type ExecutionCoordinatorDeps,
} from "../../application/execution-coordinator.use-case";
import type { RollbackSliceUseCase } from "../../application/rollback-slice.use-case";
import type { CheckpointRepositoryPort } from "../../domain/ports/checkpoint-repository.port";
import { createExecuteSliceTool } from "./execute-slice.tool";
import { createPauseExecutionTool } from "./pause-execution.tool";
import { createResumeExecutionTool } from "./resume-execution.tool";
import { registerRollbackCommand } from "./rollback.command";
import { createRollbackTool } from "./rollback.tool";

const COMPLEXITY_TO_PROFILE: Record<ComplexityTier, ModelProfileName> = {
  S: "budget",
  "F-lite": "balanced",
  "F-full": "quality",
};

export interface ExecutionExtensionExtraDeps {
  rollback?: {
    rollback: RollbackSliceUseCase;
    checkpointRepo: CheckpointRepositoryPort;
    sliceRepo: SliceRepositoryPort;
  };
  worktreeAdapter?: WorktreePort;
  modelResolver?: (profileName: string) => ResolvedModel;
  sliceRepo?: SliceRepositoryPort;
}

export function registerExecutionExtension(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: ExecutionCoordinatorDeps,
  extra?: ExecutionExtensionExtraDeps,
): void {
  const coordinator = new ExecutionCoordinator(deps);

  if (extra?.worktreeAdapter && extra?.modelResolver) {
    const worktreeAdapter = extra.worktreeAdapter;
    const modelResolver = extra.modelResolver;

    api.registerTool(createExecuteSliceTool({ coordinator, worktreeAdapter, modelResolver }));
    api.registerTool(createResumeExecutionTool({ coordinator, worktreeAdapter, modelResolver }));

    // /tff execute <slice-label> — user-invokable command
    if (extra.sliceRepo) {
      const sliceRepo = extra.sliceRepo;
      dispatcher.register({
        name: "execute",
        description: "Execute a slice — wave-based task execution in a worktree",
        handler: async (args: string, _ctx: ExtensionCommandContext) => {
          const sliceLabel = args.trim();
          if (!sliceLabel) {
            api.sendUserMessage("Usage: /tff execute <slice-label>");
            return;
          }
          const sliceResult = await sliceRepo.findByLabel(sliceLabel);
          if (!sliceResult.ok || !sliceResult.data) {
            api.sendUserMessage(`Slice not found: ${sliceLabel}`);
            return;
          }
          const slice = sliceResult.data;
          const complexity = slice.complexity ?? "S";
          const modelProfile = COMPLEXITY_TO_PROFILE[complexity];
          const model = modelResolver(modelProfile);
          const worktreePath = dirname(worktreeAdapter.resolveTffDir(slice.id));

          api.sendUserMessage(
            `Starting execution for ${sliceLabel} (${complexity}-tier, ${model.provider}/${model.modelId})...`,
          );

          const result = await coordinator.startExecution({
            sliceId: slice.id,
            milestoneId: slice.milestoneId ?? "",
            sliceLabel: slice.label,
            sliceTitle: slice.title,
            complexity,
            model,
            modelProfile,
            workingDirectory: worktreePath,
          });

          if (isErr(result)) {
            api.sendUserMessage(`Execution failed: ${result.error.message}`);
            return;
          }

          const data = result.data;
          const status =
            data.status === "completed"
              ? `Execution complete: ${data.completedTasks.length} tasks done across ${data.wavesCompleted} waves. Next: /tff verify ${sliceLabel}`
              : data.status === "paused"
                ? `Execution paused. Resume with /tff resume ${sliceLabel}`
                : `Execution failed: ${data.failureReason ?? "unknown"}. ${data.failedTasks.length} tasks failed.`;
          api.sendUserMessage(status);
        },
      });
    }
  }
  api.registerTool(createPauseExecutionTool(coordinator));

  if (extra?.rollback) {
    registerRollbackCommand(dispatcher, api, extra.rollback);
    api.registerTool(createRollbackTool(extra.rollback));
  }
}

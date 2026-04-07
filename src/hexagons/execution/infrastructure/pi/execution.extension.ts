import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import type { ExtensionAPI } from "@infrastructure/pi";
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

export interface ExecutionExtensionExtraDeps {
  rollback?: {
    rollback: RollbackSliceUseCase;
    checkpointRepo: CheckpointRepositoryPort;
    sliceRepo: SliceRepositoryPort;
  };
}

export function registerExecutionExtension(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: ExecutionCoordinatorDeps,
  extra?: ExecutionExtensionExtraDeps,
): void {
  const coordinator = new ExecutionCoordinator(deps);

  api.registerTool(createExecuteSliceTool(coordinator));
  api.registerTool(createPauseExecutionTool(coordinator));
  api.registerTool(createResumeExecutionTool(coordinator));

  if (extra?.rollback) {
    registerRollbackCommand(dispatcher, api, extra.rollback);
    api.registerTool(createRollbackTool(extra.rollback));
  }
}

import type { ExtensionAPI } from "@infrastructure/pi";
import {
  ExecutionCoordinator,
  type ExecutionCoordinatorDeps,
} from "../../application/execution-coordinator.use-case";
import { createExecuteSliceTool } from "./execute-slice.tool";
import { createPauseExecutionTool } from "./pause-execution.tool";
import { createResumeExecutionTool } from "./resume-execution.tool";

export function registerExecutionExtension(
  api: ExtensionAPI,
  deps: ExecutionCoordinatorDeps,
): void {
  const coordinator = new ExecutionCoordinator(deps);

  api.registerTool(createExecuteSliceTool(coordinator));
  api.registerTool(createPauseExecutionTool(coordinator));
  api.registerTool(createResumeExecutionTool(coordinator));
}

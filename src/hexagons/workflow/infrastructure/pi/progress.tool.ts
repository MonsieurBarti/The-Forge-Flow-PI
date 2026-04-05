import { createZodTool, textResult } from "@infrastructure/pi";
import { isErr } from "@kernel";
import { z } from "zod";
import type { GetStatusUseCase } from "../../use-cases/get-status.use-case";
import { formatDashboard } from "./progress.command";

export interface ProgressToolDeps {
  getStatus: GetStatusUseCase;
}

export function createProgressTool(deps: ProgressToolDeps) {
  return createZodTool({
    name: "tff_progress",
    label: "TFF Progress",
    description: "Show project dashboard with slice/task completion stats",
    schema: z.object({}),
    execute: async () => {
      const result = await deps.getStatus.execute();
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      const dashboard = formatDashboard(result.data);
      return textResult(JSON.stringify({ dashboard, stale: false }));
    },
  });
}

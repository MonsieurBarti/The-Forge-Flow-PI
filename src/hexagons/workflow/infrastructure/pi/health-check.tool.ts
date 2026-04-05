import { createZodTool, textResult } from "@infrastructure/pi";
import type { HealthCheckService } from "@kernel/services/health-check.service";
import { z } from "zod";

export interface HealthCheckToolDeps {
  healthCheck: HealthCheckService;
  tffDir: string;
}

export function createHealthCheckTool(deps: HealthCheckToolDeps) {
  return createZodTool({
    name: "tff_health_check",
    label: "TFF Health Check",
    description: "Run state consistency checks and return report",
    schema: z.object({}),
    execute: async () => {
      const result = await deps.healthCheck.runAll(deps.tffDir);
      if (!result.ok) {
        return textResult(JSON.stringify({ error: result.error.message }));
      }
      return textResult(JSON.stringify(result.data));
    },
  });
}

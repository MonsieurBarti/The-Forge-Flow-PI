import type { ExtensionAPI } from "@infrastructure/pi";
import type { MapCodebaseUseCase } from "../../application/map-codebase.use-case";

export interface MapCodebaseCommandDeps {
  mapCodebase: MapCodebaseUseCase;
  tffDir: string;
  workingDirectory: string;
}

export function registerMapCodebaseCommand(api: ExtensionAPI, deps: MapCodebaseCommandDeps): void {
  api.registerCommand("tff:map-codebase", {
    description: "Generate or update codebase documentation",
    handler: async (args: string) => {
      const mode = args.includes("--mode incremental")
        ? ("incremental" as const)
        : ("full" as const);

      const result = await deps.mapCodebase.execute({
        tffDir: deps.tffDir,
        workingDirectory: deps.workingDirectory,
        mode,
      });

      if (!result.ok) {
        api.sendUserMessage(`Map-codebase failed: ${result.error.message}`);
        return;
      }

      const lines = [
        "## Codebase Documentation Updated",
        "",
        `**Mode:** ${mode}`,
        `**Agents dispatched:** ${result.data.totalAgentsDispatched}`,
      ];

      if (result.data.updatedDocs.length > 0) {
        lines.push("", "**Updated:**");
        for (const doc of result.data.updatedDocs) {
          lines.push(`- ${doc}`);
        }
      }

      if (result.data.skippedDocs.length > 0) {
        lines.push("", "**Skipped (unchanged):**");
        for (const doc of result.data.skippedDocs) {
          lines.push(`- ${doc}`);
        }
      }

      api.sendUserMessage(lines.join("\n"));
    },
  });
}

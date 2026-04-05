import { createZodTool, textResult } from "@infrastructure/pi";
import { isErr } from "@kernel";
import { z } from "zod";
import type { FormatSettingsCascadeService } from "../../../settings/domain/services/format-settings-cascade.service";
import type { LoadSettingsUseCase } from "../../../settings/use-cases/load-settings.use-case";
import type { MergeSettingsUseCase } from "../../../settings/use-cases/merge-settings.use-case";

export interface ReadSettingsToolDeps {
  loadSettings: LoadSettingsUseCase;
  mergeSettings: MergeSettingsUseCase;
  formatCascade: FormatSettingsCascadeService;
  projectRoot: string;
}

export function createReadSettingsTool(deps: ReadSettingsToolDeps) {
  return createZodTool({
    name: "tff_read_settings",
    label: "TFF Read Settings",
    description: "Read current project settings with source annotations",
    schema: z.object({}),
    execute: async () => {
      const loadResult = await deps.loadSettings.execute(deps.projectRoot);
      if (isErr(loadResult)) return textResult(`Error: ${loadResult.error.message}`);

      const mergeResult = deps.mergeSettings.execute(loadResult.data);
      if (!mergeResult.ok) return textResult("Error: merge failed");
      return textResult(JSON.stringify(mergeResult.data.toJSON()));
    },
  });
}

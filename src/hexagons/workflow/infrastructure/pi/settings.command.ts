import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import { isErr } from "@kernel";
import type { TffDispatcher } from "../../../../cli/tff-dispatcher";
import type { FormatSettingsCascadeService } from "../../../settings/domain/services/format-settings-cascade.service";
import type { LoadSettingsUseCase } from "../../../settings/use-cases/load-settings.use-case";
import type { MergeSettingsUseCase } from "../../../settings/use-cases/merge-settings.use-case";

export interface SettingsCommandDeps {
  loadSettings: LoadSettingsUseCase;
  mergeSettings: MergeSettingsUseCase;
  formatCascade: FormatSettingsCascadeService;
  projectRoot: string;
}

export function registerSettingsCommand(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: SettingsCommandDeps,
): void {
  dispatcher.register({
    name: "settings",
    description: "View settings cascade with source attribution",
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      const loadResult = await deps.loadSettings.execute(deps.projectRoot);
      if (isErr(loadResult)) {
        api.sendUserMessage(`Error: ${loadResult.error.message}`);
        return;
      }

      const mergeResult = deps.mergeSettings.execute(loadResult.data);
      if (!mergeResult.ok) return;
      const cascade = deps.formatCascade.format(mergeResult.data, loadResult.data);
      api.sendUserMessage(cascade);
    },
  });
}

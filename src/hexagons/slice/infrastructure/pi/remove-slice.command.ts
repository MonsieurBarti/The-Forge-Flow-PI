import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import type { TffDispatcher } from "../../../../cli/tff-dispatcher";
import type { RemoveSliceUseCase } from "../../application/remove-slice.use-case";

export interface RemoveSliceCommandDeps {
  removeSlice: RemoveSliceUseCase;
}

export function registerRemoveSliceCommand(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: RemoveSliceCommandDeps,
): void {
  dispatcher.register({
    name: "remove-slice",
    description: "Remove a future slice from the milestone",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const sliceLabel = args.trim();
      if (!sliceLabel) {
        api.sendUserMessage("Usage: /tff remove-slice <slice-label>");
        return;
      }

      const result = await deps.removeSlice.execute({ sliceLabel });

      if (!result.ok) {
        api.sendUserMessage(`Failed to remove slice: ${result.error.message}`);
        return;
      }

      const actions = result.data.cleanupActions.join(", ");
      api.sendUserMessage(`Removed slice **${result.data.removedLabel}**. Cleanup: ${actions}`);
    },
  });
}
